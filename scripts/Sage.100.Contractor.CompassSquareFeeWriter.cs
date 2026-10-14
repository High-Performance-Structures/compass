using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Diagnostics;
using System.Reflection;
using System.Globalization;
using System.Text;

// Square processing fees → Sage, as part of the approved Compass Sage writer
// (Sage's API approval belongs to that one installed program). Each fee is a
// general-ledger entry: debit Merchant Service Fees, credit the Square deposit
// account, linked to the Square vendor when one is configured. Before writing
// it scans Sage for the same fee, entered by hand or by an earlier run, and
// reports "already in Sage" instead of posting twice. Customer receipts are
// never posted here.
namespace CompassSageClientProjectWriter
{
    internal static partial class Program
    {
        private const string FeeRequestsTarget = "/api/integrations/sage/square-payments/requests?limit=5";
        private const string FeeResultsTarget = "/api/integrations/sage/square-payments/results";
        // Duplicate-scan window around the Square payment date. Fees entered by
        // hand are usually dated with the receipt, up to a few weeks later.
        private const int DuplicateDaysBefore = 10;
        private const int DuplicateDaysAfter = 45;

        public sealed class FeeEnvelope { public FeeRequest[] requests { get; set; } }
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

        private sealed class FeeVendor
        {
            public int Number;
            public string Name;
        }

        private sealed class Outcome
        {
            public FeeRequest Request;
            public string Kind; // "succeeded" | "already_in_sage" | "failed"
            public string RecordId;
            public string RecordNumber;
            public string Note;
        }

        private static bool SquareFeeWritesEnabled()
        {
            return String.Equals(Environment.GetEnvironmentVariable("SAGE_SQUARE_FEE_WRITES_ENABLED"), "true", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Runs after the client/project writes, as a fresh child process
        /// (--square-fee-run): Sage's API can fail when one process opens a
        /// second session after closing the first. A fee problem is logged and
        /// never fails the client/project writer.
        /// </summary>
        private static void RunSquareFeesAfterWriterRun()
        {
            if (!SquareFeeWritesEnabled()) return;
            try
            {
                ProcessStartInfo start = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "--square-fee-run")
                {
                    UseShellExecute = false, // inherits this process's environment, including the fee switch
                    CreateNoWindow = true,
                };
                using (System.Diagnostics.Process child = System.Diagnostics.Process.Start(start))
                {
                    if (child == null) throw new InvalidOperationException("Could not start the Square fee run.");
                    if (!child.WaitForExit(5 * 60 * 1000))
                    {
                        WriteLog("ERROR", "Square fee run is still going after 5 minutes; leaving it to finish.");
                        return;
                    }
                    if (child.ExitCode != 0) WriteLog("ERROR", "Square fee run exited with code " + child.ExitCode + ".");
                }
            }
            catch (Exception error) { WriteLog("ERROR", "Square fee run failed to start: " + Detail(error)); }
        }

        /// <summary>--square-fee-run: posts Square fees only, in its own process with one Sage session.</summary>
        private static int RunSquareFeesOnly()
        {
            try
            {
                if (!SquareFeeWritesEnabled()) throw new InvalidOperationException("SAGE_SQUARE_FEE_WRITES_ENABLED is off.");
                Required("COMPASS_BASE_URL"); Required("SAGE_BRIDGE_SECRET"); Required("SAGE_API_USER"); Required("SAGE_API_PASSWORD");
                WriteLog("INFO", "Square fee run started.");
                PollSquareFees();
                WriteLog("INFO", "Square fee run completed.");
                return 0;
            }
            catch (Exception error)
            {
                WriteLog("ERROR", "Square fee run failed: " + Detail(error));
                return 1;
            }
        }

        /// <summary>
        /// --sage-reinit-test: no writes. Opens and closes a Sage API session
        /// twice in one process, to show whether reopening fails.
        /// </summary>
        private static int RunSageReinitTest()
        {
            for (int attempt = 1; attempt <= 2; attempt++)
            {
                try
                {
                    using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD"))) { }
                    WriteLog("INFO", "SAGE_REINIT_TEST session " + attempt + " OK");
                    Console.WriteLine("SAGE_REINIT_TEST session " + attempt + " OK");
                }
                catch (Exception error)
                {
                    WriteLog("ERROR", "SAGE_REINIT_TEST session " + attempt + " FAILED: " + Detail(error));
                    Console.WriteLine("SAGE_REINIT_TEST session " + attempt + " FAILED: " + error.GetType().Name + " " + error.Message);
                    return 1;
                }
            }
            return 0;
        }

        private static string Detail(Exception error)
        {
            return error.ToString().Replace("\r", " ").Replace("\n", " | ");
        }

        /// <summary>
        /// --square-fee-diagnose: no writes. Checks both accounts and the
        /// vendor, validates a sample entry against the installed schema, and
        /// signs in to the Sage API.
        /// </summary>
        private static int RunSquareFeeDiagnostics()
        {
            try
            {
                Required("COMPASS_BASE_URL"); Required("SAGE_BRIDGE_SECRET"); Required("SAGE_API_USER"); Required("SAGE_API_PASSWORD");
                RequireAccount(10000, "Square deposit account");
                RequireAccount(62020, "Merchant Service Fees");
                FeeVendor vendor = LoadFeeVendor();
                string xml = BuildFeeXml(Required("SAGE_API_USER"), "SQDIAG-0", DateTime.Today, "Compass diagnostic fee entry",
                    "Schema validation only", "Diagnostic line", 62020, 10000, 1.23m, vendor);
                using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD"))) { }
                WriteLog("INFO", "SQUARE_FEE_DIAGNOSTIC_OK xmlBytes=" + xml.Length + " accounts=10000,62020 vendor=" +
                    (vendor == null ? "none" : vendor.Number + " " + vendor.Name));
                Console.WriteLine("SQUARE_FEE_DIAGNOSTIC_OK");
                return 0;
            }
            catch (Exception error)
            {
                WriteLog("FATAL", "Square fee diagnostic failed: " + Detail(error));
                Console.WriteLine("SQUARE_FEE_DIAGNOSTIC_FAILED " + error.Message);
                return 1;
            }
        }

        /// <summary>The Sage vendor fees are filed under (SAGE_SQUARE_FEE_VENDOR_NUMBER), if set.</summary>
        private static FeeVendor LoadFeeVendor()
        {
            string configured = Environment.GetEnvironmentVariable("SAGE_SQUARE_FEE_VENDOR_NUMBER");
            if (String.IsNullOrWhiteSpace(configured)) return null;
            int number;
            if (!Int32.TryParse(configured.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out number))
                throw new InvalidOperationException("SAGE_SQUARE_FEE_VENDOR_NUMBER is not a number.");
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand("SELECT vndnme FROM dbo.actpay WHERE recnum = @n", connection))
            {
                command.Parameters.AddWithValue("@n", number);
                object name = command.ExecuteScalar();
                if (name == null || name == DBNull.Value) throw new InvalidOperationException("Sage vendor " + number + " was not found.");
                return new FeeVendor { Number = number, Name = Convert.ToString(name).Trim() };
            }
        }

        private static void PollSquareFees()
        {
            string json;
            try { json = Send("GET", FeeRequestsTarget, ""); }
            catch (BridgeRequestException error)
            {
                // Compass answers 503 while Square fee writes are switched off there.
                if (error.Message.Contains("(503")) return;
                throw;
            }
            FeeEnvelope envelope = Json.Deserialize<FeeEnvelope>(json);
            FeeRequest[] requests = envelope == null || envelope.requests == null ? new FeeRequest[0] : envelope.requests;
            if (requests.Length == 0) return;

            FeeVendor vendor = LoadFeeVendor();
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
                        fee.merchantFeeAccountNumber, fee.depositAccountNumber, amount, vendor);
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
                Send("POST", FeeResultsTarget, Json.Serialize(result));
                WriteLog(outcome.Kind == "failed" ? "ERROR" : "INFO", "Square fee " + outcome.Request.id + " " + outcome.Kind.ToUpperInvariant() +
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

        private const string PeriodMismatchWarning = "Posting period/year does not match the current posting period/year.";

        private static string BuildFeeXml(string user, string transactionNumber, DateTime date, string desc, string memo, string lineDesc, int feeAccount, int depositAccount, decimal amount, FeeVendor vendor)
        {
            string money = amount.ToString("0.00", CultureInfo.InvariantCulture);
            StringBuilder body = new StringBuilder();
            body.Append("<TransactionNumber>").Append(XmlEscape(transactionNumber)).Append("</TransactionNumber>");
            body.Append("<TransactionDate>").Append(date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append("</TransactionDate>");
            body.Append("<Desc>").Append(XmlEscape(Truncate(desc, 50))).Append("</Desc>");
            // Same vendor link staff use when entering these fees by hand. The
            // schema wants VendorRef/ObjectID after Desc, before Payee.
            if (vendor != null) body.Append("<VendorRef><ObjectID>").Append(vendor.Number).Append("</ObjectID></VendorRef>");
            body.Append("<Payee>").Append(XmlEscape(Truncate(vendor == null ? "Square" : vendor.Name, 50))).Append("</Payee>");
            // Post into the period of the transaction date, as staff do. Left
            // blank, Sage uses the current period and refuses the mismatch
            // (14203). HPS's fiscal year is the calendar year (Sept = period 9).
            body.Append("<AccountingPeriod>").Append(date.Month).Append("</AccountingPeriod>");
            body.Append("<PostingYear>").Append(date.Year).Append("</PostingYear>");
            body.Append("<Memo>").Append(XmlEscape(memo)).Append("</Memo>");
            // Staff click through this one warning when posting a fee into an
            // earlier month. Accept only it; any other warning still stops the
            // write. Approved by Martine 2026-10-13.
            body.Append("<APIWarningMessage>").Append(XmlEscape(PeriodMismatchWarning)).Append("</APIWarningMessage>");
            body.Append("<GeneralLedgerLineAdd><Desc>").Append(XmlEscape(Truncate(lineDesc, 50))).Append("</Desc><AccountRef><ObjectID>").Append(feeAccount)
                .Append("</ObjectID></AccountRef><DebitAmount>").Append(money).Append("</DebitAmount></GeneralLedgerLineAdd>");
            body.Append("<GeneralLedgerLineAdd><Desc>").Append(XmlEscape(Truncate(lineDesc, 50))).Append("</Desc><AccountRef><ObjectID>").Append(depositAccount)
                .Append("</ObjectID></AccountRef><CreditAmount>").Append(money).Append("</CreditAmount></GeneralLedgerLineAdd>");
            string xml = "<api:MBXML xmlns:api=\"http://sage100contractor.com/api\"><MBXMLSessionRq><Company>" + XmlEscape(TargetCompany) + "</Company><User>" + XmlEscape(user) +
                "</User></MBXMLSessionRq><MBXMLMsgsRq messageSetID=\"compass-square-fee\" onError=\"stopOnError\"><GeneralLedgerAddWithWarningRq requestID=\"" + Guid.NewGuid().ToString() + "\">" +
                body + "</GeneralLedgerAddWithWarningRq></MBXMLMsgsRq></api:MBXML>";
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

    }
}
