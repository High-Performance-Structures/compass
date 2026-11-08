using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.Text;

// Billed Compass pay requests → Sage AR invoices, as part of the approved
// Compass Sage writer (Sage's API approval belongs to that one installed
// program). Sage has no progress-billing request in its API, so Compass sends
// each billed pay request as an AR invoice (ARInvoiceAddRq): this period's
// billing by cost code, the period's retention, taxable lines flagged so Sage
// adds the sales tax. It only ever adds: an invoice number Sage already has on
// the job with the same lines total is reported as already in Sage, and the
// same number with other amounts (or on another job) is refused before any
// write. It never modifies, voids or deletes an invoice, and never posts
// anything beyond what Sage itself does when an invoice is saved.
//
// Switches (machine environment): SAGE_AR_INVOICE_WRITES_ENABLED=true runs it
// after each writer run; SAGE_AR_INVOICE_DRY_RUN=true builds and validates
// each request and reports it to Compass as a failure, writing nothing.
// "--ar-invoice-diagnose" validates a sample request against the installed
// mbxml.xsd and reads Sage's AR invoice table, writing nothing.
namespace CompassSageClientProjectWriter
{
    internal static partial class Program
    {
        private const string ArInvoiceRequestsTarget = "/api/integrations/sage/ar-invoices/requests?limit=3";
        private const string ArInvoiceResultsTarget = "/api/integrations/sage/ar-invoices/results";

        public sealed class ArInvoiceEnvelope
        {
            public string organizationId { get; set; }
            public ArInvoiceRequest[] requests { get; set; }
        }
        public sealed class ArInvoiceRequest
        {
            public string id { get; set; }
            public string claimToken { get; set; }
            public ArInvoicePayload payload { get; set; }
        }
        public sealed class ArInvoicePayload
        {
            public string operationType { get; set; }
            public string compassProjectId { get; set; }
            public string compassApplicationId { get; set; }
            public ChangeOrderJob job { get; set; }
            public ArInvoiceHeader invoice { get; set; }
            public ArInvoiceLine[] lines { get; set; }
        }
        public sealed class ArInvoiceHeader
        {
            public string number { get; set; }
            public string date { get; set; }
            public string dueDate { get; set; }
            public string description { get; set; }
            public string salesTaxDistrictRecordNumber { get; set; }
            public int invoiceType { get; set; }
            public int invoiceStatus { get; set; }
            public string retention { get; set; }
            public string linesTotal { get; set; }
            public string expectedSalesTax { get; set; }
            public string memo { get; set; }
        }
        public sealed class ArInvoiceLine
        {
            public string description { get; set; }
            public string amount { get; set; }
            public bool taxable { get; set; }
            public string accountNumber { get; set; }
            public string costCodeRecordNumber { get; set; }
        }
        private sealed class ArInvoiceOutcome
        {
            public ArInvoiceRequest Request;
            public long JobNumber;
            public bool AlreadyInSage;
            public Exception Error;
            public bool NeedsAttention;
        }
        private sealed class SageArInvoiceRow
        {
            public long RecordNumber;
            public long JobNumber;
            public decimal LinesTotal;
            public decimal SalesTax;
            public int Status;
        }
        /** A guard stopped the write: staff must look before anything is sent again. */
        private sealed class ArInvoiceAttentionException : InvalidOperationException
        {
            public ArInvoiceAttentionException(string message) : base(message) { }
        }

        private static bool ArInvoiceSwitch(string name)
        {
            return String.Equals(Environment.GetEnvironmentVariable(name), "true", StringComparison.OrdinalIgnoreCase);
        }

        /** Runs after the client/project writer, only with SAGE_AR_INVOICE_WRITES_ENABLED; never fails that run. */
        private static void RunArInvoicesAfterWriterRun()
        {
            if (!ArInvoiceSwitch("SAGE_AR_INVOICE_WRITES_ENABLED")) return;
            try { RunArInvoices(); }
            catch (Exception error) { WriteLog("ERROR", "Sage AR invoice run failed: " + error.Message); }
        }

        private static int RunArInvoicesOnly()
        {
            try
            {
                RequireConfiguration(false);
                if (!ArInvoiceSwitch("SAGE_AR_INVOICE_WRITES_ENABLED"))
                    throw new InvalidOperationException("SAGE_AR_INVOICE_WRITES_ENABLED is not true; nothing was claimed.");
                RunArInvoices();
                return 0;
            }
            catch (Exception error)
            {
                WriteLog("FATAL", "Sage AR invoice run failed: " + error.Message);
                return 1;
            }
        }

        // Read only: validates a sample ARInvoiceAddRq (a positive, a negative and a
        // taxable line, with retention) against the installed schema and reads Sage's
        // AR invoice table. No API session, no claim.
        private static int RunArInvoiceDiagnostics()
        {
            try
            {
                RequireConfiguration(false);
                string user = Required("SAGE_API_USER");
                ArInvoicePayload sample = new ArInvoicePayload
                {
                    job = new ChangeOrderJob { sageJobNumber = "1" },
                    invoice = new ArInvoiceHeader
                    {
                        number = "COMPASS-DIAG-01", date = "2026-01-31", dueDate = "2026-03-02", description = "Compass diagnostic",
                        salesTaxDistrictRecordNumber = "1", invoiceType = 1, invoiceStatus = 1, retention = "10.00",
                        linesTotal = "100.00", expectedSalesTax = "0.00", memo = "Compass diagnostic"
                    },
                    lines = new ArInvoiceLine[]
                    {
                        new ArInvoiceLine { description = "Compass diagnostic", amount = "110.00", taxable = false, accountNumber = "1", costCodeRecordNumber = "1" },
                        new ArInvoiceLine { description = "Compass diagnostic credit", amount = "-20.00", taxable = false, accountNumber = "1", costCodeRecordNumber = "1" },
                        new ArInvoiceLine { description = "Compass diagnostic taxable", amount = "10.00", taxable = true, accountNumber = "1", costCodeRecordNumber = null }
                    }
                };
                string xml = BuildArInvoiceAddXml(user, 1, sample);
                int count;
                using (SqlConnection connection = OpenSql())
                using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo.acrinv", connection))
                    count = Convert.ToInt32(command.ExecuteScalar());
                WriteLog("INFO", "AR_INVOICE_DIAGNOSTIC_OK company=" + TargetCompany + " arInvoices=" + count + " xmlBytes=" + xml.Length);
                return 0;
            }
            catch (Exception error)
            {
                WriteLog("FATAL", "Sage AR invoice diagnostic failed: " + error.Message);
                return 1;
            }
        }

        private static void RunArInvoices()
        {
            bool dryRun = ArInvoiceSwitch("SAGE_AR_INVOICE_DRY_RUN");
            ArInvoiceEnvelope envelope = Json.Deserialize<ArInvoiceEnvelope>(Send("GET", ArInvoiceRequestsTarget, ""));
            ArInvoiceRequest[] requests = envelope == null || envelope.requests == null ? new ArInvoiceRequest[0] : envelope.requests;
            if (requests.Length == 0) return;
            List<ArInvoiceOutcome> outcomes = new List<ArInvoiceOutcome>();
            using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD")))
            {
                foreach (ArInvoiceRequest request in requests)
                {
                    ArInvoiceOutcome outcome = new ArInvoiceOutcome { Request = request };
                    try { ProcessArInvoice(request, dryRun, outcome); }
                    catch (ArInvoiceAttentionException error) { outcome.Error = error; outcome.NeedsAttention = true; }
                    catch (Exception error) { outcome.Error = error; }
                    outcomes.Add(outcome);
                }
            }

            // Sage commits accepted requests when the API session is disposed, so the
            // invoice is read back (and Compass told) only after that.
            foreach (ArInvoiceOutcome outcome in outcomes)
            {
                SageArInvoiceRow added = null;
                if (outcome.Error == null)
                {
                    try
                    {
                        added = FindArInvoiceOnJob(outcome.JobNumber, outcome.Request.payload.invoice.number.Trim());
                        if (added == null)
                            throw new ArInvoiceAttentionException("Sage accepted the invoice but it doesn't read back on job " + outcome.JobNumber + "; check Sage before sending again.");
                    }
                    catch (ArInvoiceAttentionException error) { outcome.Error = error; outcome.NeedsAttention = true; }
                    catch (Exception error) { outcome.Error = error; outcome.NeedsAttention = true; }
                }
                Dictionary<string, object> result = new Dictionary<string, object> {
                    { "id", outcome.Request.id }, { "claimToken", outcome.Request.claimToken }
                };
                if (outcome.Error != null)
                {
                    WriteLog("ERROR", outcome.Request.id + " AR INVOICE FAILED " + outcome.Error.Message);
                    result["outcome"] = "failed";
                    result["error"] = Truncate(outcome.Error.Message, 4000);
                    result["needsAttention"] = outcome.NeedsAttention;
                }
                else
                {
                    WriteLog("INFO", outcome.Request.id + " AR INVOICE " + (outcome.AlreadyInSage ? "FOUND" : "ADDED") + " job=" + outcome.JobNumber + " recnum=" + added.RecordNumber);
                    result["outcome"] = "succeeded";
                    result["sageRecordId"] = added.RecordNumber.ToString(CultureInfo.InvariantCulture);
                    result["alreadyInSage"] = outcome.AlreadyInSage;
                    result["sageInvoiceTotal"] = (added.LinesTotal + added.SalesTax).ToString("0.00", CultureInfo.InvariantCulture);
                    result["sageSalesTax"] = added.SalesTax.ToString("0.00", CultureInfo.InvariantCulture);
                }
                Send("POST", ArInvoiceResultsTarget, Json.Serialize(result));
            }
        }

        private static void ProcessArInvoice(ArInvoiceRequest request, bool dryRun, ArInvoiceOutcome outcome)
        {
            ArInvoicePayload payload = request == null ? null : request.payload;
            if (payload == null || payload.job == null || payload.invoice == null || payload.lines == null || payload.lines.Length == 0)
                throw new InvalidOperationException("Compass AR invoice payload is incomplete; no write was attempted.");
            if (!String.Equals(payload.operationType, "add_ar_invoice", StringComparison.Ordinal))
                throw new InvalidOperationException("Compass requested an unsupported Sage AR invoice operation.");
            long jobNumber;
            if (!Int64.TryParse(payload.job.sageJobNumber, NumberStyles.None, CultureInfo.InvariantCulture, out jobNumber) || jobNumber < 1)
                throw new InvalidOperationException("Compass did not provide a valid Sage job number; no write was attempted.");
            outcome.JobNumber = jobNumber;
            string number = (payload.invoice.number ?? "").Trim();
            if (number.Length == 0 || number.Length > 20)
                throw new InvalidOperationException("The Sage invoice number must be 1 to 20 characters; no write was attempted.");
            decimal linesTotal = ParseAmount(payload.invoice.linesTotal, "lines total");
            decimal sum = 0m;
            foreach (ArInvoiceLine line in payload.lines) sum += ParseAmount(line.amount, "line amount");
            if (sum != linesTotal)
                throw new InvalidOperationException("The invoice lines don't add up to its total; no write was attempted.");
            ParseAmount(payload.invoice.retention, "retention");

            RunStage("check Sage job", delegate { RequireSageJob(jobNumber, payload.job.sageJobId); return true; });
            RunStage("check Sage cost codes, accounts and tax district", delegate { RequireArInvoiceReferences(payload); return true; });

            // Never a second copy: the invoice number decides. The same number on this
            // job with the same lines total is the invoice already in Sage; anything
            // else with that number stops here for a person to look.
            foreach (SageArInvoiceRow row in RunStage("read Sage AR invoices", delegate { return ArInvoicesNumbered(number); }))
            {
                if (row.Status == 5) continue;
                if (row.JobNumber == jobNumber && row.LinesTotal == linesTotal)
                {
                    outcome.AlreadyInSage = true;
                    return;
                }
                throw new ArInvoiceAttentionException("Sage already has invoice " + number + (row.JobNumber == jobNumber ? "" : " on job " + row.JobNumber) + " with lines totalling " + row.LinesTotal.ToString("0.00", CultureInfo.InvariantCulture) + "; Compass's is " + linesTotal.ToString("0.00", CultureInfo.InvariantCulture) + ". No write was attempted.");
            }

            string user = Required("SAGE_API_USER");
            string xml = BuildArInvoiceAddXml(user, jobNumber, payload);
            if (dryRun)
                throw new InvalidOperationException("DRY RUN (nothing written): would add AR invoice " + number + " to Sage job " + jobNumber + " with " + payload.lines.Length + " line(s) totalling " + linesTotal.ToString("0.00", CultureInfo.InvariantCulture) + ", retention " + payload.invoice.retention + ".");
            RunStage("submit Sage AR invoice add", delegate { Submit(xml, Required("SAGE_API_PASSWORD")); });
        }

        private static void RequireArInvoiceReferences(ArInvoicePayload payload)
        {
            using (SqlConnection connection = OpenSql())
            {
                foreach (ArInvoiceLine line in payload.lines)
                {
                    long account;
                    if (!Int64.TryParse(line.accountNumber, NumberStyles.None, CultureInfo.InvariantCulture, out account))
                        throw new InvalidOperationException("Compass sent an invalid Sage ledger account; no write was attempted.");
                    using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo.lgract WHERE recnum=@account", connection))
                    {
                        command.Parameters.AddWithValue("@account", account);
                        if (Convert.ToInt32(command.ExecuteScalar()) != 1)
                            throw new InvalidOperationException("Sage has no ledger account " + line.accountNumber + "; no write was attempted.");
                    }
                    if (String.IsNullOrWhiteSpace(line.costCodeRecordNumber)) continue;
                    decimal code;
                    if (!Decimal.TryParse(line.costCodeRecordNumber, NumberStyles.None, CultureInfo.InvariantCulture, out code))
                        throw new InvalidOperationException("Compass sent an invalid Sage cost code; no write was attempted.");
                    using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo.cstcde WHERE recnum=@code", connection))
                    {
                        command.Parameters.AddWithValue("@code", code);
                        if (Convert.ToInt32(command.ExecuteScalar()) != 1)
                            throw new InvalidOperationException("Sage has no cost code " + line.costCodeRecordNumber + "; no write was attempted.");
                    }
                }
                string district = payload.invoice.salesTaxDistrictRecordNumber;
                if (String.IsNullOrWhiteSpace(district)) return;
                long districtNumber;
                if (!Int64.TryParse(district, NumberStyles.None, CultureInfo.InvariantCulture, out districtNumber))
                    throw new InvalidOperationException("Compass sent an invalid Sage tax district; no write was attempted.");
                using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo.taxdst WHERE recnum=@district", connection))
                {
                    command.Parameters.AddWithValue("@district", districtNumber);
                    if (Convert.ToInt32(command.ExecuteScalar()) != 1)
                        throw new InvalidOperationException("Sage has no tax district " + district + "; no write was attempted.");
                }
            }
        }

        // The lines total comes from the invoice's own lines (arivln), so it compares
        // with Compass's lines whatever Sage does with retention in its header totals.
        private const string ArInvoiceRowsSql = "SELECT i.recnum, ISNULL(i.jobnum, 0), ISNULL((SELECT SUM(l.extprc) FROM dbo.arivln l WHERE l.recnum=i.recnum), 0), ISNULL(i.slstax, 0), ISNULL(i.status, 0) FROM dbo.acrinv i ";

        private static List<SageArInvoiceRow> ReadArInvoiceRows(SqlCommand command)
        {
            List<SageArInvoiceRow> rows = new List<SageArInvoiceRow>();
            using (SqlDataReader reader = command.ExecuteReader())
                while (reader.Read()) rows.Add(new SageArInvoiceRow {
                    RecordNumber = Convert.ToInt64(reader[0]),
                    JobNumber = Convert.ToInt64(reader[1]),
                    LinesTotal = Convert.ToDecimal(reader[2]),
                    SalesTax = Convert.ToDecimal(reader[3]),
                    Status = Convert.ToInt32(reader[4])
                });
            return rows;
        }

        private static List<SageArInvoiceRow> ArInvoicesNumbered(string number)
        {
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand(ArInvoiceRowsSql + "WHERE LTRIM(RTRIM(i.invnum))=@number", connection))
            {
                command.Parameters.AddWithValue("@number", number);
                return ReadArInvoiceRows(command);
            }
        }

        private static SageArInvoiceRow FindArInvoiceOnJob(long jobNumber, string number)
        {
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand(ArInvoiceRowsSql + "WHERE i.jobnum=@job AND LTRIM(RTRIM(i.invnum))=@number AND ISNULL(i.status, 0)<>5 ORDER BY i.recnum DESC", connection))
            {
                command.Parameters.AddWithValue("@job", jobNumber);
                command.Parameters.AddWithValue("@number", number);
                List<SageArInvoiceRow> rows = ReadArInvoiceRows(command);
                return rows.Count == 0 ? null : rows[0];
            }
        }

        private static string Positive(decimal value)
        {
            return Math.Abs(value).ToString("0.00", CultureInfo.InvariantCulture);
        }

        // ARInvoiceAddRq is a sequence, so elements are written in the schema's
        // order. Sage's UnitPrice can't be negative: a credit line is quantity -1 at
        // the positive price. The request is validated against the installed mbxml.xsd.
        private static string BuildArInvoiceAddXml(string user, long jobNumber, ArInvoicePayload payload)
        {
            ArInvoiceHeader invoice = payload.invoice;
            StringBuilder body = new StringBuilder();
            AppendElement(body, "InvoiceNumber", invoice.number.Trim());
            AppendElement(body, "InvoiceDate", invoice.date);
            AppendReference(body, "JobRef", jobNumber.ToString(CultureInfo.InvariantCulture));
            AppendElement(body, "Desc", Truncate((invoice.description ?? "").Trim(), 50));
            if (!String.IsNullOrWhiteSpace(invoice.salesTaxDistrictRecordNumber))
                AppendReference(body, "SalesTaxDistrictRef", invoice.salesTaxDistrictRecordNumber.Trim());
            AppendElement(body, "DueDate", invoice.dueDate);
            AppendElement(body, "DiscountDate", invoice.date);
            AppendElement(body, "InvoiceType", invoice.invoiceType.ToString(CultureInfo.InvariantCulture));
            AppendElement(body, "InvoiceStatus", invoice.invoiceStatus.ToString(CultureInfo.InvariantCulture));
            AppendElement(body, "Retention", ParseAmount(invoice.retention, "retention").ToString("0.00", CultureInfo.InvariantCulture));
            if (!String.IsNullOrWhiteSpace(invoice.memo)) AppendElement(body, "Memo", invoice.memo.Trim());
            foreach (ArInvoiceLine line in payload.lines)
            {
                decimal amount = ParseAmount(line.amount, "line amount");
                body.Append("<ARInvoiceLineAdd>");
                AppendElement(body, "Desc", Truncate((line.description ?? "").Trim(), 75));
                AppendElement(body, "Quantity", amount < 0 ? "-1" : "1");
                AppendElement(body, "UnitPrice", Positive(amount));
                AppendElement(body, "IsTaxable", line.taxable ? "Y" : "N");
                AppendReference(body, "AccountRef", line.accountNumber);
                if (!String.IsNullOrWhiteSpace(line.costCodeRecordNumber)) AppendReference(body, "CostCodeRef", line.costCodeRecordNumber.Trim());
                body.Append("</ARInvoiceLineAdd>");
            }
            string xml = "<api:MBXML xmlns:api=\"http://sage100contractor.com/api\"><MBXMLSessionRq><Company>" + XmlEscape(TargetCompany) + "</Company><User>" + XmlEscape(user) + "</User></MBXMLSessionRq><MBXMLMsgsRq messageSetID=\"compass-ar-invoice\" onError=\"stopOnError\"><ARInvoiceAddRq requestID=\"" + Guid.NewGuid().ToString() + "\">" + body.ToString() + "</ARInvoiceAddRq></MBXMLMsgsRq></api:MBXML>";
            ValidateXml(xml);
            return xml;
        }
    }
}
