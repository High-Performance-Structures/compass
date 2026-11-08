using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.Text;

// Change orders → Sage, as part of the approved Compass Sage writer (Sage's
// API approval belongs to that one installed program). Staff confirm an
// executed change order or variance in Compass; the writer adds it to Sage as
// an approved prime change order (ChangeOrderAddRq) with one
// PrimeChangeDetailAdd line per cost code. It only ever adds: a change order
// Sage already has (same number and amount, or same description and amount)
// is linked, not added again, and a same-number change order with another
// amount is refused. It never modifies or deletes a Sage change order.
//
// Switches (machine environment): SAGE_CHANGE_ORDER_WRITES_ENABLED=true runs
// it after each writer run; SAGE_CHANGE_ORDER_DRY_RUN=true builds and
// validates each request and reports it to Compass as a failure, writing
// nothing. "--change-order-diagnose" validates a sample request against the
// installed mbxml.xsd and reads Sage's change order tables, writing nothing.
namespace CompassSageClientProjectWriter
{
    internal static partial class Program
    {
        private const string ChangeOrderRequestsTarget = "/api/integrations/sage/change-orders/requests?limit=5";
        private const string ChangeOrderResultsTarget = "/api/integrations/sage/change-orders/results";

        public sealed class ChangeOrderEnvelope
        {
            public string organizationId { get; set; }
            public ChangeOrderRequest[] requests { get; set; }
        }
        public sealed class ChangeOrderRequest
        {
            public string id { get; set; }
            public string claimToken { get; set; }
            public ChangeOrderPayload payload { get; set; }
        }
        public sealed class ChangeOrderPayload
        {
            public string operationType { get; set; }
            public string compassProjectId { get; set; }
            public string compassChangeOrderId { get; set; }
            public ChangeOrderJob job { get; set; }
            public ChangeOrderHeader changeOrder { get; set; }
            public ChangeOrderLine[] lines { get; set; }
        }
        public sealed class ChangeOrderJob
        {
            public string sageJobNumber { get; set; }
            public string sageJobId { get; set; }
        }
        public sealed class ChangeOrderHeader
        {
            public string number { get; set; }
            public string date { get; set; }
            public string approvedDate { get; set; }
            public string description { get; set; }
            public int statusNumber { get; set; }
            public string totalApprovedAmount { get; set; }
        }
        public sealed class ChangeOrderLine
        {
            public string description { get; set; }
            public string costCodeRecordNumber { get; set; }
            public int costTypeNumber { get; set; }
            public string approvedAmount { get; set; }
        }
        private sealed class PrimeChangeOrder
        {
            public long RecordNumber;
            public string Number;
            public string Description;
            public decimal ApprovedAmount;
        }
        private sealed class ChangeOrderOutcome
        {
            public ChangeOrderRequest Request;
            public long JobNumber;
            public string Number;
            public string RecordId;
            public bool AlreadyInSage;
            public Exception Error;
        }

        private static bool ChangeOrderSwitch(string name)
        {
            return String.Equals(Environment.GetEnvironmentVariable(name), "true", StringComparison.OrdinalIgnoreCase);
        }

        /** Runs after the client/project writer, only with SAGE_CHANGE_ORDER_WRITES_ENABLED; never fails that run. */
        private static void RunChangeOrdersAfterWriterRun()
        {
            if (!ChangeOrderSwitch("SAGE_CHANGE_ORDER_WRITES_ENABLED")) return;
            RunStageInChildProcess("--change-order-run", "Sage change order");
        }

        private static int RunChangeOrdersOnly()
        {
            try
            {
                RequireConfiguration(false);
                if (!ChangeOrderSwitch("SAGE_CHANGE_ORDER_WRITES_ENABLED"))
                    throw new InvalidOperationException("SAGE_CHANGE_ORDER_WRITES_ENABLED is not true; nothing was claimed.");
                RunChangeOrders();
                return 0;
            }
            catch (Exception error)
            {
                WriteLog("FATAL", "Sage change order run failed: " + error.ToString());
                return 1;
            }
        }

        // Read only: validates a sample ChangeOrderAddRq against the installed
        // schema and reads Sage's change order tables. No API session, no claim.
        private static int RunChangeOrderDiagnostics()
        {
            try
            {
                RequireConfiguration(false);
                string user = Required("SAGE_API_USER");
                string xml = BuildChangeOrderAddXml(user, 1, new ChangeOrderPayload {
                    changeOrder = new ChangeOrderHeader {
                        number = "V-000", date = "2026-01-01", approvedDate = "2026-01-01",
                        description = "Compass diagnostic", statusNumber = 1, totalApprovedAmount = "12.34"
                    },
                    lines = new ChangeOrderLine[] {
                        new ChangeOrderLine { description = "Compass diagnostic", costCodeRecordNumber = "1", costTypeNumber = 5, approvedAmount = "12.34" }
                    }
                });
                int count;
                using (SqlConnection connection = OpenSql())
                using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo.prmchg", connection))
                    count = Convert.ToInt32(command.ExecuteScalar());
                WriteLog("INFO", "CHANGE_ORDER_DIAGNOSTIC_OK company=" + TargetCompany + " primeChangeOrders=" + count + " xmlBytes=" + xml.Length);
                return 0;
            }
            catch (Exception error)
            {
                WriteLog("FATAL", "Sage change order diagnostic failed: " + error.Message);
                return 1;
            }
        }

        private static void RunChangeOrders()
        {
            bool dryRun = ChangeOrderSwitch("SAGE_CHANGE_ORDER_DRY_RUN");
            ChangeOrderEnvelope envelope = Json.Deserialize<ChangeOrderEnvelope>(Send("GET", ChangeOrderRequestsTarget, ""));
            ChangeOrderRequest[] requests = envelope == null || envelope.requests == null ? new ChangeOrderRequest[0] : envelope.requests;
            if (requests.Length == 0) return;
            List<ChangeOrderOutcome> outcomes = new List<ChangeOrderOutcome>();
            using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD")))
            {
                foreach (ChangeOrderRequest request in requests)
                {
                    try { outcomes.Add(ProcessChangeOrder(request, dryRun)); }
                    catch (Exception error) { outcomes.Add(new ChangeOrderOutcome { Request = request, Error = error }); }
                }
            }

            // Sage commits accepted requests when the API session is disposed, so
            // added change orders are read back (and Compass told) only after that.
            foreach (ChangeOrderOutcome outcome in outcomes)
            {
                if (outcome.Error == null && outcome.RecordId == null)
                {
                    try
                    {
                        PrimeChangeOrder added = FindPrimeChangeOrderByNumber(outcome.JobNumber, outcome.Number);
                        if (added == null) throw new InvalidOperationException("Sage accepted the change order but it could not be read back; check Sage before sending it again.");
                        outcome.RecordId = added.RecordNumber.ToString(CultureInfo.InvariantCulture);
                    }
                    catch (Exception error) { outcome.Error = error; }
                }
                Dictionary<string, object> result = new Dictionary<string, object> {
                    { "id", outcome.Request.id }, { "claimToken", outcome.Request.claimToken }
                };
                if (outcome.Error != null)
                {
                    WriteLog("ERROR", outcome.Request.id + " CHANGE ORDER FAILED " + outcome.Error.Message);
                    result["outcome"] = "failed";
                    result["error"] = Truncate(outcome.Error.Message, 4000);
                }
                else
                {
                    WriteLog("INFO", outcome.Request.id + " CHANGE ORDER " + (outcome.AlreadyInSage ? "MATCHED" : "ADDED") + " recnum=" + outcome.RecordId);
                    result["outcome"] = "succeeded";
                    result["sageRecordId"] = outcome.RecordId;
                    result["alreadyInSage"] = outcome.AlreadyInSage;
                }
                Send("POST", ChangeOrderResultsTarget, Json.Serialize(result));
            }
        }

        private static decimal ParseAmount(string value, string label)
        {
            decimal parsed;
            if (String.IsNullOrWhiteSpace(value) || !Decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out parsed))
                throw new InvalidOperationException("Compass sent an invalid " + label + "; no write was attempted.");
            return parsed;
        }

        private static ChangeOrderOutcome ProcessChangeOrder(ChangeOrderRequest request, bool dryRun)
        {
            ChangeOrderPayload payload = request == null ? null : request.payload;
            if (payload == null || payload.job == null || payload.changeOrder == null || payload.lines == null || payload.lines.Length == 0)
                throw new InvalidOperationException("Compass change order payload is incomplete; no write was attempted.");
            if (!String.Equals(payload.operationType, "add_prime_change_order", StringComparison.Ordinal))
                throw new InvalidOperationException("Compass requested an unsupported Sage change order operation.");
            long jobNumber;
            if (!Int64.TryParse(payload.job.sageJobNumber, NumberStyles.None, CultureInfo.InvariantCulture, out jobNumber) || jobNumber < 1)
                throw new InvalidOperationException("Compass did not provide a valid Sage job number; no write was attempted.");
            string number = (payload.changeOrder.number ?? "").Trim();
            if (number.Length == 0 || number.Length > 20)
                throw new InvalidOperationException("The Sage change order number must be 1 to 20 characters; no write was attempted.");
            decimal total = ParseAmount(payload.changeOrder.totalApprovedAmount, "change order total");
            decimal lineSum = 0m;
            foreach (ChangeOrderLine line in payload.lines) lineSum += ParseAmount(line.approvedAmount, "line amount");
            if (lineSum != total)
                throw new InvalidOperationException("The change order's lines don't add up to its total; no write was attempted.");

            RunStage("check Sage job", delegate { RequireSageJob(jobNumber, payload.job.sageJobId); return true; });
            RunStage("check Sage cost codes", delegate { RequireCostCodes(payload.lines); return true; });

            // Never add a second copy: the same number or the same description on
            // this job is the change order already in Sage.
            List<PrimeChangeOrder> existing = RunStage("read Sage change orders", delegate { return PrimeChangeOrdersForJob(jobNumber); });
            foreach (PrimeChangeOrder row in existing)
            {
                bool sameNumber = String.Equals(row.Number.Trim(), number, StringComparison.OrdinalIgnoreCase);
                bool sameDescription = String.Equals(row.Description.Trim(), (payload.changeOrder.description ?? "").Trim(), StringComparison.OrdinalIgnoreCase);
                if ((sameNumber || sameDescription) && row.ApprovedAmount == total)
                    return new ChangeOrderOutcome { Request = request, JobNumber = jobNumber, Number = row.Number, RecordId = row.RecordNumber.ToString(CultureInfo.InvariantCulture), AlreadyInSage = true };
                if (sameNumber)
                    throw new InvalidOperationException("Sage already has change order " + row.Number + " on this job with approved amount " + row.ApprovedAmount.ToString("0.00", CultureInfo.InvariantCulture) + "; no write was attempted.");
            }

            string user = Required("SAGE_API_USER");
            string xml = BuildChangeOrderAddXml(user, jobNumber, payload);
            if (dryRun)
                throw new InvalidOperationException("DRY RUN (nothing written): would add change order " + number + " to Sage job " + jobNumber + " for " + total.ToString("0.00", CultureInfo.InvariantCulture) + " with " + payload.lines.Length + " line(s).");
            RunStage("submit Sage change order add", delegate { Submit(xml, Required("SAGE_API_PASSWORD")); });
            return new ChangeOrderOutcome { Request = request, JobNumber = jobNumber, Number = number, RecordId = null, AlreadyInSage = false };
        }

        private static void RequireSageJob(long jobNumber, string sageJobId)
        {
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand("SELECT CONVERT(varchar(36), _idnum) FROM dbo.actrec WHERE recnum=@job", connection))
            {
                command.Parameters.AddWithValue("@job", jobNumber);
                object value = command.ExecuteScalar();
                if (value == null || value is DBNull) throw new InvalidOperationException("Sage has no job " + jobNumber + "; no write was attempted.");
                if (!String.IsNullOrWhiteSpace(sageJobId) && !String.Equals(Convert.ToString(value), sageJobId.Trim(), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("The Sage job ID and number do not identify the same job; no write was attempted.");
            }
        }

        private static void RequireCostCodes(ChangeOrderLine[] lines)
        {
            using (SqlConnection connection = OpenSql())
            {
                foreach (ChangeOrderLine line in lines)
                {
                    decimal code;
                    if (!Decimal.TryParse(line.costCodeRecordNumber, NumberStyles.None, CultureInfo.InvariantCulture, out code))
                        throw new InvalidOperationException("Compass sent an invalid Sage cost code; no write was attempted.");
                    using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo.cstcde WHERE recnum=@code", connection))
                    {
                        command.Parameters.AddWithValue("@code", code);
                        if (Convert.ToInt32(command.ExecuteScalar()) != 1)
                            throw new InvalidOperationException("Sage has no cost code " + line.costCodeRecordNumber + "; no write was attempted.");
                    }
                    using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo.csttyp WHERE recnum=@type", connection))
                    {
                        command.Parameters.AddWithValue("@type", line.costTypeNumber);
                        if (Convert.ToInt32(command.ExecuteScalar()) != 1)
                            throw new InvalidOperationException("Sage has no cost type " + line.costTypeNumber + "; no write was attempted.");
                    }
                }
            }
        }

        private static List<PrimeChangeOrder> PrimeChangeOrdersForJob(long jobNumber)
        {
            List<PrimeChangeOrder> rows = new List<PrimeChangeOrder>();
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand("SELECT recnum, ISNULL(chgnum, ''), ISNULL(dscrpt, ''), ISNULL(appamt, 0) FROM dbo.prmchg WHERE jobnum=@job", connection))
            {
                command.Parameters.AddWithValue("@job", jobNumber);
                using (SqlDataReader reader = command.ExecuteReader())
                    while (reader.Read()) rows.Add(new PrimeChangeOrder {
                        RecordNumber = Convert.ToInt64(reader[0]),
                        Number = Convert.ToString(reader[1]),
                        Description = Convert.ToString(reader[2]),
                        ApprovedAmount = Convert.ToDecimal(reader[3])
                    });
            }
            return rows;
        }

        private static PrimeChangeOrder FindPrimeChangeOrderByNumber(long jobNumber, string number)
        {
            PrimeChangeOrder found = null;
            foreach (PrimeChangeOrder row in PrimeChangeOrdersForJob(jobNumber))
            {
                if (!String.Equals(row.Number.Trim(), number.Trim(), StringComparison.OrdinalIgnoreCase)) continue;
                if (found != null) throw new InvalidOperationException("Sage has two change orders numbered " + number + " on job " + jobNumber + ".");
                found = row;
            }
            return found;
        }

        private static void AppendElement(StringBuilder xml, string name, string value)
        {
            xml.Append("<").Append(name).Append(">").Append(XmlEscape(value)).Append("</").Append(name).Append(">");
        }

        private static void AppendReference(StringBuilder xml, string name, string id)
        {
            xml.Append("<").Append(name).Append("><ObjectID>").Append(XmlEscape(id)).Append("</ObjectID></").Append(name).Append(">");
        }

        // ChangeOrderAddRq is a sequence, so elements are written in the schema's
        // order; the result is validated against the installed mbxml.xsd.
        private static string BuildChangeOrderAddXml(string user, long jobNumber, ChangeOrderPayload payload)
        {
            ChangeOrderHeader header = payload.changeOrder;
            StringBuilder body = new StringBuilder();
            AppendElement(body, "ChangeOrderNumber", (header.number ?? "").Trim());
            AppendElement(body, "ChangeOrderDate", header.date);
            AppendReference(body, "JobRef", jobNumber.ToString(CultureInfo.InvariantCulture));
            AppendElement(body, "Desc", Truncate((header.description ?? "").Trim(), 50));
            AppendElement(body, "ApprovedDate", header.approvedDate);
            AppendElement(body, "PrimeChangeStatus", header.statusNumber.ToString(CultureInfo.InvariantCulture));
            foreach (ChangeOrderLine line in payload.lines)
            {
                // Each Compass change order arrives as its own request with its own
                // lines; lines are never merged across change orders.
                body.Append("<PrimeChangeDetailAdd>");
                AppendElement(body, "Desc", Truncate((line.description ?? "").Trim(), 50));
                AppendElement(body, "RequestedAmount", line.approvedAmount);
                AppendElement(body, "ApprovedAmount", line.approvedAmount);
                AppendReference(body, "CostCodeRef", line.costCodeRecordNumber);
                AppendReference(body, "CostTypeRef", line.costTypeNumber.ToString(CultureInfo.InvariantCulture));
                body.Append("</PrimeChangeDetailAdd>");
            }
            string xml = "<api:MBXML xmlns:api=\"http://sage100contractor.com/api\"><MBXMLSessionRq><Company>" + XmlEscape(TargetCompany) + "</Company><User>" + XmlEscape(user) + "</User></MBXMLSessionRq><MBXMLMsgsRq messageSetID=\"compass-change-order\" onError=\"stopOnError\"><ChangeOrderAddRq requestID=\"" + Guid.NewGuid().ToString() + "\">" + body + "</ChangeOrderAddRq></MBXMLMsgsRq></api:MBXML>";
            ValidateXml(xml);
            return xml;
        }
    }
}
