using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Xml;
using System.Xml.Schema;

// Posts Square processing fees from Compass into Sage 100 Contractor as a
// general-ledger entry: debit Merchant Service Fees, credit the Square deposit
// account. Before writing, it scans Sage for the same fee (entered by hand or
// by an earlier run) and reports "already in Sage" instead of posting twice.
// Customer receipts are never posted here; Sage has no supported receipt API.
namespace CompassSageSquareFeeWriter
{
    internal static class Program
    {
        private const string ApiDllPath = @"C:\Program Files (x86)\Sage\Sage 100 Contractor SQL\Sage.100.Contractor.Api.dll";
        private const string XsdPath = @"C:\Program Files (x86)\Sage\Sage 100 Contractor SQL\mbxml.xsd";
        private const string TargetCompany = "High Performance Structures Inc";
        private const string AppName = "Compass.Sage.SquareFeeWriter";
        private const string RequestsTarget = "/api/integrations/sage/square-payments/requests?limit=5";
        private const string ResultsTarget = "/api/integrations/sage/square-payments/results";
        private const string LogPath = @"C:\ProgramData\HPS\CompassSageWriter\logs\square-fee-writer.log";
        private const string PreviousLogPath = @"C:\ProgramData\HPS\CompassSageWriter\logs\square-fee-writer.previous.log";
        private const long MaxLogBytes = 5L * 1024L * 1024L;
        // Duplicate-scan window around the Square payment date. Fees entered by
        // hand are usually dated with the receipt, up to a few weeks later.
        private const int DuplicateDaysBefore = 10;
        private const int DuplicateDaysAfter = 45;
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly object LogLock = new object();
        private static Type ImbxmlType;
        private static Type GlobalType;
        private static object ApiInstance;
        private static bool ApiInitialized;

        public sealed class Envelope { public FeeRequest[] requests { get; set; } }
        public sealed class FeeRequest
        {
            public string id { get; set; }
            public string claimToken { get; set; }
            public FeePayload payload { get; set; }
        }
        public sealed class FeePayload
        {
            public string operationType { get; set; }
            public string company { get; set; }
            public string squarePaymentId { get; set; }
            public string squareInvoiceId { get; set; }
            public string department { get; set; }
            public string sageInvoiceId { get; set; }
            public string sageInvoiceNumber { get; set; }
            public long processingFeeCents { get; set; }
            public string currency { get; set; }
            public int depositAccountNumber { get; set; }
            public int merchantFeeAccountNumber { get; set; }
            public string paymentCompletedAt { get; set; }
        }

        private sealed class InvoiceContext
        {
            public string InvoiceNumber;
            public string JobNumber;
            public string JobName;
            public string ClientName;
        }

        private sealed class Outcome
        {
            public FeeRequest Request;
            public string Kind; // "succeeded" | "already_in_sage" | "failed"
            public string RecordId;
            public string RecordNumber;
            public string Note;
        }

        private sealed class ApiSession : IDisposable
        {
            public ApiSession(string user, string password)
            {
                try
                {
                    Directory.SetCurrentDirectory(Path.GetDirectoryName(ApiDllPath));
                    Assembly assembly = Assembly.LoadFrom(ApiDllPath);
                    ImbxmlType = assembly.GetType("Sage.SMB.API.IMBXML", true);
                    GlobalType = assembly.GetType("Sage.SMB.API.mbAPIGlobal", true);
                    ApiInstance = Activator.CreateInstance(ImbxmlType);
                    InvokeStatic("SetRqDataSource", new object[] { DataSource() });
                    Invoke("SetDataSource", new object[] { DataSource() });
                    Invoke("IntializeAPI", new object[0]);
                    ApiInitialized = true;
                    InvokeStatic("SetRqDataSource", new object[] { DataSource() });
                    InvokeStatic("ResetRqAcceptState", new object[0]);
                    InvokeStatic("EnableAcceptRq", new object[] { true });
                    Invoke("SetDataSource", new object[] { DataSource() });
                    Invoke("EnableRequests", new object[0]);
                    object allowed = Invoke("IsApplicationAllowed", new object[] { user, password });
                    if (!(allowed is int) || (int)allowed != 0) throw new InvalidOperationException("The Sage API application is not allowed (code " + Convert.ToString(allowed) + ").");
                    object valid = Invoke("IsValidUser", new object[] { TargetCompany, user, password });
                    if (!(valid is bool) || !(bool)valid) throw new InvalidOperationException("The API user is not valid for the selected Sage company.");
                }
                catch
                {
                    ResetApi(true);
                    throw;
                }
            }
            public void Dispose() { ResetApi(false); }
        }

        private static void ResetApi(bool suppressErrors)
        {
            try { if (ApiInitialized && ApiInstance != null) Invoke("DeIntializeAPI", new object[0]); }
            catch { if (!suppressErrors) throw; }
            finally { ApiInitialized = false; ApiInstance = null; }
        }

        public static int Main(string[] args)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            bool diagnose = args.Length > 0 && String.Equals(args[0], "--diagnose", StringComparison.OrdinalIgnoreCase);
            try
            {
                RequireConfiguration(!diagnose);
                if (diagnose)
                {
                    RunDiagnostics();
                    return 0;
                }
                WriteLog("INFO", "Square fee writer run started.");
                PollOnce();
                WriteLog("INFO", "Square fee writer run completed.");
                return 0;
            }
            catch (Exception error)
            {
                WriteLog("FATAL", error.Message);
                return 1;
            }
        }

        private static void RequireConfiguration(bool requireWriteSwitch)
        {
            string baseUrl = Required("COMPASS_BASE_URL"); Required("SAGE_BRIDGE_SECRET");
            Required("SAGE_API_USER"); Required("SAGE_API_PASSWORD");
            Uri parsed;
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out parsed) ||
                !String.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
                !String.IsNullOrEmpty(parsed.Query) || !String.IsNullOrEmpty(parsed.Fragment))
                throw new InvalidOperationException("COMPASS_BASE_URL must be an absolute HTTPS URL without a query or fragment.");
            if (requireWriteSwitch && !String.Equals(Environment.GetEnvironmentVariable("SAGE_SQUARE_FEE_WRITES_ENABLED"), "true", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Local Square fee write switch (SAGE_SQUARE_FEE_WRITES_ENABLED) is off.");
            if (!File.Exists(ApiDllPath) || !File.Exists(XsdPath))
                throw new FileNotFoundException("The Sage API DLL or mbxml.xsd is missing.");
        }

        /// <summary>
        /// No writes: checks both accounts exist, builds and validates a sample
        /// entry against the installed schema, and signs in to the Sage API.
        /// </summary>
        private static void RunDiagnostics()
        {
            RequireAccount(10000, "Square deposit account");
            RequireAccount(62020, "Merchant Service Fees");
            string xml = BuildFeeXml(Required("SAGE_API_USER"), "SQDIAG-0", DateTime.Today, "Compass diagnostic fee entry", "Schema validation only", "Diagnostic line", 62020, 10000, 1.23m);
            using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD"))) { }
            WriteLog("INFO", "DIAGNOSTIC_OK company=" + TargetCompany + " xmlBytes=" + xml.Length + " accounts=10000,62020");
        }

        private static void PollOnce()
        {
            string json = Send("GET", RequestsTarget, "");
            Envelope envelope = Json.Deserialize<Envelope>(json);
            FeeRequest[] requests = envelope == null || envelope.requests == null ? new FeeRequest[0] : envelope.requests;
            if (requests.Length == 0) return;

            List<Outcome> outcomes = new List<Outcome>();
            List<FeeRequest> toWrite = new List<FeeRequest>();
            Dictionary<string, string> transactionNumbers = new Dictionary<string, string>();
            Dictionary<string, string> xmlByRequest = new Dictionary<string, string>();

            // Duplicate scan and validation happen before any Sage API session.
            foreach (FeeRequest request in requests)
            {
                try
                {
                    FeePayload fee = ValidatePayload(request);
                    InvoiceContext invoice = LoadInvoice(fee);
                    string transactionNumber = TransactionNumber(fee);
                    string match = FindExistingFee(fee, invoice, transactionNumber);
                    if (match != null)
                    {
                        string[] parts = match.Split('|');
                        outcomes.Add(new Outcome { Request = request, Kind = "already_in_sage", RecordId = parts[0], RecordNumber = parts[1], Note = parts[2] });
                        continue;
                    }
                    DateTime paid = PaymentDate(fee);
                    decimal amount = fee.processingFeeCents / 100m;
                    string client = String.IsNullOrWhiteSpace(invoice.ClientName) ? "client" : invoice.ClientName;
                    string desc = Truncate("Square fee " + invoice.InvoiceNumber + " " + client, 50);
                    string memo = "Square processing fee for " + client + ", job " + invoice.JobNumber +
                        (String.IsNullOrWhiteSpace(invoice.JobName) ? "" : " " + invoice.JobName) +
                        ", Sage invoice " + invoice.InvoiceNumber + " (record " + fee.sageInvoiceId + ")" +
                        ", Square payment " + fee.squarePaymentId + ", paid " + paid.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) +
                        ". Posted by Compass.";
                    string lineDesc = Truncate("Square fee " + invoice.InvoiceNumber + " " + client, 50);
                    xmlByRequest[request.id] = BuildFeeXml(Required("SAGE_API_USER"), transactionNumber, paid, desc, memo, lineDesc,
                        fee.merchantFeeAccountNumber, fee.depositAccountNumber, amount);
                    transactionNumbers[request.id] = transactionNumber;
                    toWrite.Add(request);
                }
                catch (Exception error)
                {
                    outcomes.Add(new Outcome { Request = request, Kind = "failed", Note = error.Message });
                }
            }

            if (toWrite.Count > 0)
            {
                Dictionary<string, Exception> writeErrors = new Dictionary<string, Exception>();
                using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD")))
                {
                    foreach (FeeRequest request in toWrite)
                    {
                        try { Submit(xmlByRequest[request.id], Required("SAGE_API_PASSWORD")); }
                        catch (Exception error) { writeErrors[request.id] = error; }
                    }
                }
                // Sage commits when the session closes; read every entry back before reporting success.
                foreach (FeeRequest request in toWrite)
                {
                    Exception error;
                    if (writeErrors.TryGetValue(request.id, out error))
                    {
                        outcomes.Add(new Outcome { Request = request, Kind = "failed", Note = error.Message });
                        continue;
                    }
                    try
                    {
                        string recordId = ReadBack(transactionNumbers[request.id], request.payload);
                        outcomes.Add(new Outcome { Request = request, Kind = "succeeded", RecordId = recordId, RecordNumber = transactionNumbers[request.id] });
                    }
                    catch (Exception readError)
                    {
                        outcomes.Add(new Outcome { Request = request, Kind = "failed", Note = "Written but not confirmed in Sage: " + readError.Message });
                    }
                }
            }

            foreach (Outcome outcome in outcomes)
            {
                Dictionary<string, object> result = new Dictionary<string, object> {
                    { "operationId", outcome.Request.id }, { "claimToken", outcome.Request.claimToken }, { "outcome", outcome.Kind } };
                if (outcome.Kind == "failed") result["error"] = Truncate(outcome.Note, 4000);
                else
                {
                    result["sageRecordId"] = outcome.RecordId;
                    result["sageRecordNumber"] = outcome.RecordNumber;
                    if (outcome.Kind == "already_in_sage") result["matchReason"] = Truncate(outcome.Note, 500);
                }
                Send("POST", ResultsTarget, Json.Serialize(result));
                WriteLog(outcome.Kind == "failed" ? "ERROR" : "INFO", outcome.Request.id + " " + outcome.Kind.ToUpperInvariant() +
                    (outcome.RecordNumber == null ? "" : " record=" + outcome.RecordNumber) + (outcome.Note == null ? "" : " " + outcome.Note));
            }
        }

        private static FeePayload ValidatePayload(FeeRequest request)
        {
            if (request == null || request.payload == null) throw new InvalidOperationException("Compass payload is incomplete.");
            FeePayload fee = request.payload;
            if (!String.Equals(fee.operationType, "post_square_processing_fee", StringComparison.Ordinal))
                throw new InvalidOperationException("Only Square processing fees are written by this writer.");
            if (!String.Equals(fee.company, TargetCompany, StringComparison.Ordinal))
                throw new InvalidOperationException("Compass payload targets the wrong Sage company.");
            if (!String.Equals(fee.currency, "USD", StringComparison.Ordinal) || fee.processingFeeCents <= 0 || fee.processingFeeCents > 1000000)
                throw new InvalidOperationException("The fee amount is not a positive USD amount under $10,000.");
            // The accounts are pinned in Compass; never let a payload choose others.
            if (fee.depositAccountNumber != 10000 || fee.merchantFeeAccountNumber != 62020)
                throw new InvalidOperationException("Unexpected accounts in the fee payload.");
            int ignored;
            if (!Int32.TryParse(fee.sageInvoiceId, NumberStyles.None, CultureInfo.InvariantCulture, out ignored))
                throw new InvalidOperationException("The Sage invoice record is not a number.");
            return fee;
        }

        private static InvoiceContext LoadInvoice(FeePayload fee)
        {
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand(
                "SELECT i.invnum, j.recnum AS jobnum, j.jobnme, c.clnnme FROM dbo.acrinv i " +
                "LEFT JOIN dbo.actrec j ON j.recnum = i.jobnum LEFT JOIN dbo.reccln c ON c.recnum = j.clnnum WHERE i.recnum = @id", connection))
            {
                command.Parameters.AddWithValue("@id", Int32.Parse(fee.sageInvoiceId, CultureInfo.InvariantCulture));
                using (SqlDataReader reader = command.ExecuteReader())
                {
                    if (!reader.Read()) throw new InvalidOperationException("Sage invoice record " + fee.sageInvoiceId + " was not found.");
                    InvoiceContext invoice = new InvoiceContext {
                        InvoiceNumber = Convert.ToString(reader["invnum"]).Trim(),
                        JobNumber = Convert.ToString(reader["jobnum"]).Trim(),
                        JobName = Convert.ToString(reader["jobnme"]).Trim(),
                        ClientName = Convert.ToString(reader["clnnme"]).Trim(),
                    };
                    if (!String.Equals(invoice.InvoiceNumber, (fee.sageInvoiceNumber ?? "").Trim(), StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Sage invoice record " + fee.sageInvoiceId + " is " + invoice.InvoiceNumber + ", not " + fee.sageInvoiceNumber + ".");
                    return invoice;
                }
            }
        }

        /// <summary>
        /// A stable transaction number per Square payment and fee amount, so a
        /// retry or a second run finds its own entry.
        /// </summary>
        private static string TransactionNumber(FeePayload fee)
        {
            string id = new string(Array.FindAll((fee.squarePaymentId ?? "").ToCharArray(), Char.IsLetterOrDigit));
            if (id.Length < 6) throw new InvalidOperationException("The Square payment id is missing.");
            return Truncate("SQF" + id.Substring(0, Math.Min(10, id.Length)) + "-" + fee.processingFeeCents.ToString(CultureInfo.InvariantCulture), 20);
        }

        /// <summary>
        /// Returns "recordId|transactionNumber|why" when Sage already has this fee:
        /// the same transaction number, or a Merchant Service Fees debit of the
        /// same amount near the payment date that names the invoice, payment or
        /// Square. A same-amount fee near the date with nothing to tie it to the
        /// payment stops the write for a person to check.
        /// </summary>
        private static string FindExistingFee(FeePayload fee, InvoiceContext invoice, string transactionNumber)
        {
            DateTime paid = PaymentDate(fee);
            decimal amount = fee.processingFeeCents / 100m;
            using (SqlConnection connection = OpenSql())
            {
                using (SqlCommand byNumber = new SqlCommand("SELECT TOP 1 recnum, trnnum FROM dbo.lgrtrn WHERE trnnum = @trn", connection))
                {
                    byNumber.Parameters.AddWithValue("@trn", transactionNumber);
                    using (SqlDataReader reader = byNumber.ExecuteReader())
                        if (reader.Read()) return Convert.ToString(reader["recnum"]) + "|" + Convert.ToString(reader["trnnum"]).Trim() + "|Same transaction number already in Sage";
                }
                using (SqlCommand byAmount = new SqlCommand(
                    "SELECT h.recnum, h.trnnum, h.trndte, h.dscrpt, CAST(h.ntetxt AS nvarchar(max)) AS note, l.dscrpt AS linedesc " +
                    "FROM dbo.lgtnln l JOIN dbo.lgrtrn h ON h.recnum = l.recnum " +
                    "WHERE l.lgract = @fees AND l.dbtamt = @amount AND h.trndte BETWEEN @from AND @to", connection))
                {
                    byAmount.Parameters.AddWithValue("@fees", fee.merchantFeeAccountNumber);
                    byAmount.Parameters.AddWithValue("@amount", amount);
                    byAmount.Parameters.AddWithValue("@from", paid.AddDays(-DuplicateDaysBefore));
                    byAmount.Parameters.AddWithValue("@to", paid.AddDays(DuplicateDaysAfter));
                    string unexplained = null;
                    using (SqlDataReader reader = byAmount.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            string text = (Convert.ToString(reader["dscrpt"]) + " " + Convert.ToString(reader["note"]) + " " + Convert.ToString(reader["linedesc"])).ToLowerInvariant();
                            string trnnum = Convert.ToString(reader["trnnum"]).Trim();
                            string record = Convert.ToString(reader["recnum"]) + "|" + trnnum;
                            if (NamesThisPayment(text, trnnum, fee, invoice))
                                return record + "|Matching Merchant Service Fees entry of $" + amount.ToString("0.00", CultureInfo.InvariantCulture) + " dated " + Convert.ToDateTime(reader["trndte"]).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                            if (unexplained == null) unexplained = Convert.ToString(reader["trnnum"]).Trim();
                        }
                    }
                    if (unexplained != null)
                        throw new InvalidOperationException("Possible duplicate: Sage transaction " + unexplained + " debits Merchant Service Fees $" +
                            amount.ToString("0.00", CultureInfo.InvariantCulture) + " near this payment but doesn't name it. Check it, then retry.");
                }
            }
            return null;
        }

        /// <summary>
        /// How staff describe Square fees they enter by hand: "SQ-9-18-26",
        /// "Merchant Service Fees - Peck", "Barnett Square Fees 9/14/2026".
        /// </summary>
        private static bool NamesThisPayment(string text, string transactionNumber, FeePayload fee, InvoiceContext invoice)
        {
            if (text.Contains(invoice.InvoiceNumber.ToLowerInvariant())) return true;
            if (!String.IsNullOrEmpty(fee.squarePaymentId) && text.Contains(fee.squarePaymentId.ToLowerInvariant())) return true;
            if (text.Contains("square") || transactionNumber.StartsWith("SQ", StringComparison.OrdinalIgnoreCase)) return true;
            foreach (string word in (invoice.ClientName ?? "").ToLowerInvariant().Split(new[] { ' ', ',', '.', '&', '-' }, StringSplitOptions.RemoveEmptyEntries))
                if (word.Length >= 4 && text.Contains(word)) return true;
            return false;
        }

        private static void RequireAccount(int number, string label)
        {
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo.lgract WHERE recnum = @n AND ISNULL(inactv, 0) = 0", connection))
            {
                command.Parameters.AddWithValue("@n", number);
                if (Convert.ToInt32(command.ExecuteScalar()) != 1) throw new InvalidOperationException(label + " account " + number + " is missing or inactive in Sage.");
            }
        }

        private static string BuildFeeXml(string user, string transactionNumber, DateTime date, string desc, string memo, string lineDesc, int feeAccount, int depositAccount, decimal amount)
        {
            string money = amount.ToString("0.00", CultureInfo.InvariantCulture);
            StringBuilder body = new StringBuilder();
            body.Append("<TransactionNumber>").Append(XmlEscape(transactionNumber)).Append("</TransactionNumber>");
            body.Append("<TransactionDate>").Append(date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append("</TransactionDate>");
            body.Append("<Desc>").Append(XmlEscape(Truncate(desc, 50))).Append("</Desc>");
            body.Append("<Payee>Square</Payee>");
            body.Append("<Memo>").Append(XmlEscape(memo)).Append("</Memo>");
            body.Append("<GeneralLedgerLineAdd><Desc>").Append(XmlEscape(Truncate(lineDesc, 50))).Append("</Desc><AccountRef><ObjectID>").Append(feeAccount)
                .Append("</ObjectID></AccountRef><DebitAmount>").Append(money).Append("</DebitAmount></GeneralLedgerLineAdd>");
            body.Append("<GeneralLedgerLineAdd><Desc>").Append(XmlEscape(Truncate(lineDesc, 50))).Append("</Desc><AccountRef><ObjectID>").Append(depositAccount)
                .Append("</ObjectID></AccountRef><CreditAmount>").Append(money).Append("</CreditAmount></GeneralLedgerLineAdd>");
            string xml = "<api:MBXML xmlns:api=\"http://sage100contractor.com/api\"><MBXMLSessionRq><Company>" + XmlEscape(TargetCompany) + "</Company><User>" + XmlEscape(user) +
                "</User></MBXMLSessionRq><MBXMLMsgsRq messageSetID=\"compass-square-fee\" onError=\"stopOnError\"><GeneralLedgerAddRq requestID=\"" + Guid.NewGuid().ToString() + "\">" +
                body + "</GeneralLedgerAddRq></MBXMLMsgsRq></api:MBXML>";
            ValidateXml(xml);
            return xml;
        }

        private static string ReadBack(string transactionNumber, FeePayload fee)
        {
            decimal amount = fee.processingFeeCents / 100m;
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand(
                "SELECT h.recnum, SUM(CASE WHEN l.lgract = @fees THEN l.dbtamt ELSE 0 END) AS debit, SUM(CASE WHEN l.lgract = @dep THEN l.crdamt ELSE 0 END) AS credit " +
                "FROM dbo.lgrtrn h JOIN dbo.lgtnln l ON l.recnum = h.recnum WHERE h.trnnum = @trn GROUP BY h.recnum", connection))
            {
                command.Parameters.AddWithValue("@trn", transactionNumber);
                command.Parameters.AddWithValue("@fees", fee.merchantFeeAccountNumber);
                command.Parameters.AddWithValue("@dep", fee.depositAccountNumber);
                using (SqlDataReader reader = command.ExecuteReader())
                {
                    if (!reader.Read()) throw new InvalidOperationException("transaction " + transactionNumber + " not found after the write.");
                    if (Convert.ToDecimal(reader["debit"]) != amount || Convert.ToDecimal(reader["credit"]) != amount)
                        throw new InvalidOperationException("transaction " + transactionNumber + " amounts don't match $" + amount.ToString("0.00", CultureInfo.InvariantCulture) + ".");
                    string recordId = Convert.ToString(reader["recnum"]);
                    if (reader.Read()) throw new InvalidOperationException("more than one Sage transaction is numbered " + transactionNumber + ".");
                    return recordId;
                }
            }
        }

        private static DateTime PaymentDate(FeePayload fee)
        {
            DateTimeOffset paid;
            if (!DateTimeOffset.TryParse(fee.paymentCompletedAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out paid))
                throw new InvalidOperationException("The payment date is missing.");
            // The company keeps its books in Mountain time.
            TimeZoneInfo mountain = TimeZoneInfo.FindSystemTimeZoneById("Mountain Standard Time");
            return TimeZoneInfo.ConvertTime(paid, mountain).Date;
        }

        private static SqlConnection OpenSql()
        {
            string configured = Environment.GetEnvironmentVariable("SAGE_SQL_CONNECTION_STRING");
            string connectionString = String.IsNullOrWhiteSpace(configured)
                ? "Data Source=" + DataSource() + ";Initial Catalog=" + TargetCompany + ";Integrated Security=True;Application Name=" + AppName + ";TrustServerCertificate=True"
                : configured;
            SqlConnection connection = new SqlConnection(connectionString);
            connection.Open();
            using (SqlCommand command = new SqlCommand("SELECT DB_NAME()", connection))
            {
                string actual = Convert.ToString(command.ExecuteScalar());
                if (!String.Equals(actual, TargetCompany, StringComparison.Ordinal))
                {
                    connection.Dispose();
                    throw new InvalidOperationException("SQL connection resolved to '" + actual + "', not the approved Sage company.");
                }
            }
            return connection;
        }

        private static void ValidateXml(string xml)
        {
            StringBuilder errors = new StringBuilder();
            XmlSchemaSet schemas = new XmlSchemaSet();
            schemas.Add(null, XsdPath);
            XmlReaderSettings settings = new XmlReaderSettings { Schemas = schemas, ValidationType = ValidationType.Schema };
            settings.ValidationEventHandler += delegate(object sender, ValidationEventArgs args) { errors.AppendLine(args.Message); };
            using (StringReader input = new StringReader(xml))
            using (XmlReader reader = XmlReader.Create(input, settings)) while (reader.Read()) { }
            if (errors.Length > 0) throw new InvalidOperationException("Sage XML validation failed before write: " + errors.ToString().Trim());
        }

        private static string Submit(string xml, string password)
        {
            object response = Invoke("submitXML", new object[] { xml, password });
            string text = Convert.ToString(response);
            XmlDocument document = new XmlDocument();
            try { document.LoadXml(text); }
            catch (Exception error) { throw new InvalidOperationException("Sage API returned an invalid XML response: " + Truncate(text.Replace("\r", " ").Replace("\n", " "), 1000), error); }
            XmlNodeList statuses = document.SelectNodes("//*[@statusCode]");
            if (statuses == null || statuses.Count == 0) throw new InvalidOperationException("Sage API response did not include a status code.");
            foreach (XmlNode node in statuses)
            {
                XmlElement element = node as XmlElement;
                if (element == null) continue;
                string code = element.GetAttribute("statusCode");
                if (!String.Equals(code, "0", StringComparison.Ordinal))
                    throw new InvalidOperationException("Sage API rejected the entry (code " + code + "): " + element.GetAttribute("statusMessage"));
            }
            return text;
        }

        private static string Send(string method, string target, string body)
        {
            string baseUrl = Required("COMPASS_BASE_URL").TrimEnd('/');
            string timestamp = Convert.ToInt64((DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds).ToString(CultureInfo.InvariantCulture);
            string requestId = Guid.NewGuid().ToString();
            string signature = Sign(Required("SAGE_BRIDGE_SECRET"), timestamp + "." + requestId + "." + method + "." + target + "." + body);
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(baseUrl + target);
            request.Method = method; request.Timeout = 60000; request.ReadWriteTimeout = 60000;
            request.Headers["x-compass-timestamp"] = timestamp;
            request.Headers["x-compass-request-id"] = requestId;
            request.Headers["x-compass-signature"] = "sha256=" + signature;
            if (method == "POST")
            {
                byte[] bytes = Encoding.UTF8.GetBytes(body); request.ContentType = "application/json"; request.ContentLength = bytes.Length;
                using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
            }
            try { using (HttpWebResponse response = (HttpWebResponse)request.GetResponse()) using (StreamReader reader = new StreamReader(response.GetResponseStream())) return reader.ReadToEnd(); }
            catch (WebException error)
            {
                HttpWebResponse response = error.Response as HttpWebResponse;
                string details = "";
                if (response != null) using (StreamReader reader = new StreamReader(response.GetResponseStream())) details = reader.ReadToEnd();
                // Compass answers 503 while fee writes are switched off; that's not an error.
                if (response != null && (int)response.StatusCode == 503 && method == "GET") return "{\"requests\":[]}";
                throw new InvalidOperationException("Compass bridge request failed (" + (response == null ? error.Status.ToString() : ((int)response.StatusCode).ToString(CultureInfo.InvariantCulture)) + "): " + details, error);
            }
        }

        private static void WriteLog(string level, string message)
        {
            lock (LogLock)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
                    if (File.Exists(LogPath) && new FileInfo(LogPath).Length > MaxLogBytes)
                    {
                        if (File.Exists(PreviousLogPath)) File.Delete(PreviousLogPath);
                        File.Move(LogPath, PreviousLogPath);
                    }
                    File.AppendAllText(LogPath, DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + " " + level + " " + message + Environment.NewLine);
                }
                catch { }
            }
        }

        private static string Sign(string secret, string payload)
        {
            using (HMACSHA256 hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret)))
            {
                byte[] hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
                StringBuilder result = new StringBuilder(); foreach (byte value in hash) result.Append(value.ToString("x2")); return result.ToString();
            }
        }

        private static object Invoke(string name, object[] args) { return InvokeMethod(FindMethod(ImbxmlType, name, args.Length, false), ApiInstance, args); }
        private static object InvokeStatic(string name, object[] args) { return InvokeMethod(FindMethod(GlobalType, name, args.Length, true), null, args); }
        private static object InvokeMethod(MethodInfo method, object target, object[] args)
        {
            try { return method.Invoke(target, args); }
            catch (TargetInvocationException error)
            {
                Exception inner = error.InnerException;
                if (inner == null) throw;
                throw new InvalidOperationException(String.IsNullOrWhiteSpace(inner.Message) ? inner.GetType().FullName : inner.Message, inner);
            }
        }
        private static MethodInfo FindMethod(Type type, string name, int count, bool isStatic)
        {
            BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | (isStatic ? BindingFlags.Static : BindingFlags.Instance);
            foreach (MethodInfo method in type.GetMethods(flags)) if (String.Equals(method.Name, name, StringComparison.OrdinalIgnoreCase) && method.GetParameters().Length == count) return method;
            throw new MissingMethodException(type.FullName, name);
        }
        private static string Required(string name)
        {
            string value = Environment.GetEnvironmentVariable(name);
            if (String.IsNullOrWhiteSpace(value)) throw new InvalidOperationException(name + " is required.");
            return value.Trim();
        }
        private static string DataSource() { return Environment.GetEnvironmentVariable("SAGE_SQL_SERVER") ?? @"NUC-PC\SQLEXPRESS"; }
        private static string Truncate(string value, int length) { if (String.IsNullOrEmpty(value)) return value; return value.Length <= length ? value : value.Substring(0, length); }
        private static string XmlEscape(string value) { return SecurityElement.Escape(value ?? "") ?? ""; }
    }
}
