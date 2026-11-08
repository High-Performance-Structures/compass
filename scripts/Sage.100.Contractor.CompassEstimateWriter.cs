using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.Text;

// Accepted estimates → Sage, as part of the approved Compass Sage writer
// (Sage's API approval belongs to that one installed program). Compass queues
// an accepted estimate once Sage has its job; the writer adds the job's
// proposal (ProposalAddRq, one ProposalLineAdd per estimate line with the
// whole amount in Other, "Taxable" in UserDefined1 and the tax in Memo for a
// taxable line) and, when the company sends it, the job budget at cost
// (BudgetAddRq, one line per cost code). It only ever adds: a job that already has proposal
// lines (or budget lines, when a budget is sent) is left alone and reported
// as needing attention. It never modifies or deletes a proposal or budget.
//
// Switches (machine environment): SAGE_ESTIMATE_WRITES_ENABLED=true runs it
// after each writer run; SAGE_ESTIMATE_DRY_RUN=true builds and validates each
// request and reports it to Compass as a failure, writing nothing.
// "--estimate-diagnose" validates sample requests against the installed
// mbxml.xsd and reads Sage's proposal table, writing nothing.
namespace CompassSageClientProjectWriter
{
    internal static partial class Program
    {
        private const string EstimateRequestsTarget = "/api/integrations/sage/estimates/requests?limit=3";
        private const string EstimateResultsTarget = "/api/integrations/sage/estimates/results";
        // Per-estimate-line proposals with Taxable tags; Compass no longer sends the
        // older per-cost-code "add_job_proposal".
        private const string EstimateOperation = "add_job_proposal_lines";

        public sealed class EstimateEnvelope
        {
            public string organizationId { get; set; }
            public EstimateRequest[] requests { get; set; }
        }
        public sealed class EstimateRequest
        {
            public string id { get; set; }
            public string claimToken { get; set; }
            public EstimatePayload payload { get; set; }
        }
        public sealed class EstimatePayload
        {
            public string operationType { get; set; }
            public string compassProjectId { get; set; }
            public string compassEstimateId { get; set; }
            public ChangeOrderJob job { get; set; }
            public EstimateSection proposal { get; set; }
            public EstimateSection budget { get; set; }
        }
        public sealed class EstimateSection
        {
            public EstimateLine[] lines { get; set; }
            public string totalAmount { get; set; }
        }
        public sealed class EstimateLine
        {
            public string description { get; set; }
            public string costCodeRecordNumber { get; set; }
            public string otherAmount { get; set; }
            /** Proposal lines only: "Taxable" or empty. */
            public string userDefined1 { get; set; }
            /** Proposal lines only: the tax name and rate, or empty. */
            public string memo { get; set; }
        }
        private sealed class EstimateOutcome
        {
            public EstimateRequest Request;
            public long JobNumber;
            public Exception Error;
            public bool NeedsAttention;
        }
        /** A guard stopped the write: staff must look before anything is sent again. */
        private sealed class EstimateAttentionException : InvalidOperationException
        {
            public EstimateAttentionException(string message) : base(message) { }
        }

        private static bool EstimateSwitch(string name)
        {
            return String.Equals(Environment.GetEnvironmentVariable(name), "true", StringComparison.OrdinalIgnoreCase);
        }

        /** Runs after the client/project writer, only with SAGE_ESTIMATE_WRITES_ENABLED; never fails that run. */
        private static void RunEstimatesAfterWriterRun()
        {
            if (!EstimateSwitch("SAGE_ESTIMATE_WRITES_ENABLED")) return;
            try { RunEstimates(); }
            catch (Exception error) { WriteLog("ERROR", "Sage estimate run failed: " + error.ToString()); }
        }

        private static int RunEstimatesOnly()
        {
            try
            {
                RequireConfiguration(false);
                if (!EstimateSwitch("SAGE_ESTIMATE_WRITES_ENABLED"))
                    throw new InvalidOperationException("SAGE_ESTIMATE_WRITES_ENABLED is not true; nothing was claimed.");
                RunEstimates();
                return 0;
            }
            catch (Exception error)
            {
                WriteLog("FATAL", "Sage estimate run failed: " + error.ToString());
                return 1;
            }
        }

        // Read only: validates sample ProposalAddRq and BudgetAddRq requests against
        // the installed schema and reads Sage's proposal table. No API session, no claim.
        private static int RunEstimateDiagnostics()
        {
            try
            {
                RequireConfiguration(false);
                string user = Required("SAGE_API_USER");
                EstimateLine[] sample = new EstimateLine[] { new EstimateLine { description = "Compass diagnostic", costCodeRecordNumber = "1", otherAmount = "12.34", userDefined1 = "Taxable", memo = "Compass diagnostic tax 2.9%" } };
                string proposal = BuildProposalAddXml(user, 1, sample);
                string budget = BuildBudgetAddXml(user, 1, sample);
                int count;
                using (SqlConnection connection = OpenSql())
                using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo.prplin", connection))
                    count = Convert.ToInt32(command.ExecuteScalar());
                WriteLog("INFO", "ESTIMATE_DIAGNOSTIC_OK company=" + TargetCompany + " proposalLines=" + count + " xmlBytes=" + (proposal.Length + budget.Length));
                return 0;
            }
            catch (Exception error)
            {
                WriteLog("FATAL", "Sage estimate diagnostic failed: " + error.Message);
                return 1;
            }
        }

        private static void RunEstimates()
        {
            bool dryRun = EstimateSwitch("SAGE_ESTIMATE_DRY_RUN");
            EstimateEnvelope envelope = Json.Deserialize<EstimateEnvelope>(Send("GET", EstimateRequestsTarget, ""));
            EstimateRequest[] requests = envelope == null || envelope.requests == null ? new EstimateRequest[0] : envelope.requests;
            if (requests.Length == 0) return;
            List<EstimateOutcome> outcomes = new List<EstimateOutcome>();
            // Opening or closing the Sage session can fail outside any one request.
            // Every claimed export still gets a result, so none is left running for
            // Compass to re-claim every few minutes without anyone seeing why.
            Exception sessionError = null;
            try
            {
                using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD")))
                {
                    foreach (EstimateRequest request in requests)
                    {
                        EstimateOutcome outcome = new EstimateOutcome { Request = request };
                        try { ProcessEstimate(request, dryRun, outcome); }
                        catch (EstimateAttentionException error) { outcome.Error = error; outcome.NeedsAttention = true; }
                        catch (Exception error) { outcome.Error = error; WriteLog("ERROR", request.id + " ESTIMATE DETAIL " + error.ToString()); }
                        outcomes.Add(outcome);
                    }
                }
            }
            catch (Exception error)
            {
                sessionError = error;
                WriteLog("ERROR", "Sage estimate session failed: " + error.ToString());
            }
            foreach (EstimateRequest request in requests)
            {
                if (outcomes.Exists(delegate (EstimateOutcome done) { return done.Request == request; })) continue;
                // The session never opened for this request, so nothing was sent.
                outcomes.Add(new EstimateOutcome {
                    Request = request,
                    Error = new InvalidOperationException("The Sage API session could not be opened; nothing was sent. " + (sessionError == null ? "" : sessionError.Message))
                });
            }

            // Sage commits accepted requests when the API session is disposed, so the
            // proposal is read back (and Compass told) only after that.
            foreach (EstimateOutcome outcome in outcomes)
            {
                int lineCount = 0;
                decimal total = 0m;
                if (outcome.Error == null)
                {
                    try
                    {
                        ReadProposal(outcome.JobNumber, out lineCount, out total);
                        decimal expected = ParseAmount(outcome.Request.payload.proposal.totalAmount, "proposal total");
                        if (lineCount != outcome.Request.payload.proposal.lines.Length || total != expected)
                            throw new EstimateAttentionException("Sage accepted the proposal but it reads back as " + lineCount + " lines, " + total.ToString("0.00", CultureInfo.InvariantCulture) + "; check Sage job " + outcome.JobNumber + "." + (sessionError == null ? "" : " Closing the Sage API session failed: " + sessionError.Message));
                    }
                    catch (EstimateAttentionException error) { outcome.Error = error; outcome.NeedsAttention = true; }
                    catch (Exception error) { outcome.Error = error; outcome.NeedsAttention = true; }
                }
                Dictionary<string, object> result = new Dictionary<string, object> {
                    { "id", outcome.Request.id }, { "claimToken", outcome.Request.claimToken }
                };
                if (outcome.Error != null)
                {
                    WriteLog("ERROR", outcome.Request.id + " ESTIMATE FAILED " + outcome.Error.Message);
                    result["outcome"] = "failed";
                    result["error"] = Truncate(outcome.Error.Message, 4000);
                    result["needsAttention"] = outcome.NeedsAttention;
                }
                else
                {
                    EstimateSection budget = outcome.Request.payload.budget;
                    WriteLog("INFO", outcome.Request.id + " ESTIMATE ADDED job=" + outcome.JobNumber + " proposalLines=" + lineCount);
                    result["outcome"] = "succeeded";
                    result["proposalLineCount"] = lineCount;
                    result["proposalTotal"] = total.ToString("0.00", CultureInfo.InvariantCulture);
                    result["budgetLineCount"] = budget == null || budget.lines == null ? null : (object)budget.lines.Length;
                }
                Send("POST", EstimateResultsTarget, Json.Serialize(result));
            }
        }

        private static decimal SumLines(EstimateSection section, string label)
        {
            decimal sum = 0m;
            foreach (EstimateLine line in section.lines) sum += ParseAmount(line.otherAmount, label + " line amount");
            if (sum != ParseAmount(section.totalAmount, label + " total"))
                throw new InvalidOperationException("The " + label + " lines don't add up to its total; no write was attempted.");
            return sum;
        }

        private static void ProcessEstimate(EstimateRequest request, bool dryRun, EstimateOutcome outcome)
        {
            EstimatePayload payload = request == null ? null : request.payload;
            if (payload == null || payload.job == null || payload.proposal == null || payload.proposal.lines == null || payload.proposal.lines.Length == 0)
                throw new InvalidOperationException("Compass estimate payload is incomplete; no write was attempted.");
            if (!String.Equals(payload.operationType, EstimateOperation, StringComparison.Ordinal))
                throw new InvalidOperationException("Compass requested an unsupported Sage estimate operation.");
            long jobNumber;
            if (!Int64.TryParse(payload.job.sageJobNumber, NumberStyles.None, CultureInfo.InvariantCulture, out jobNumber) || jobNumber < 1)
                throw new InvalidOperationException("Compass did not provide a valid Sage job number; no write was attempted.");
            outcome.JobNumber = jobNumber;
            bool sendBudget = payload.budget != null && payload.budget.lines != null && payload.budget.lines.Length > 0;
            decimal proposalTotal = SumLines(payload.proposal, "proposal");
            if (sendBudget) SumLines(payload.budget, "budget");

            RunStage("check Sage job", delegate { RequireSageJob(jobNumber, payload.job.sageJobId); return true; });
            RunStage("check Sage cost codes", delegate { RequireEstimateCostCodes(payload); return true; });

            // Never a second proposal (or budget): the job's own rows decide.
            int existingLines;
            decimal existingTotal;
            ReadProposal(jobNumber, out existingLines, out existingTotal);
            if (existingLines > 0)
                throw new EstimateAttentionException("Sage already has a proposal for job " + jobNumber + " (" + existingLines + " lines, " + existingTotal.ToString("0.00", CultureInfo.InvariantCulture) + "); Compass's would be " + payload.proposal.lines.Length + " lines, " + proposalTotal.ToString("0.00", CultureInfo.InvariantCulture) + ". No write was attempted.");
            if (sendBudget && BudgetLineCount(jobNumber) > 0)
                throw new EstimateAttentionException("Sage already has a budget for job " + jobNumber + "; no write was attempted.");

            string user = Required("SAGE_API_USER");
            string proposalXml = BuildProposalAddXml(user, jobNumber, payload.proposal.lines);
            string budgetXml = sendBudget ? BuildBudgetAddXml(user, jobNumber, payload.budget.lines) : null;
            if (dryRun)
                throw new InvalidOperationException("DRY RUN (nothing written): would add a proposal of " + payload.proposal.lines.Length + " line(s) for " + proposalTotal.ToString("0.00", CultureInfo.InvariantCulture) + " to Sage job " + jobNumber + (sendBudget ? " and a budget of " + payload.budget.lines.Length + " line(s)" : "") + ".");
            string password = Required("SAGE_API_PASSWORD");
            RunStage("submit Sage proposal add", delegate { Submit(proposalXml, password); });
            if (budgetXml != null)
            {
                try { RunStage("submit Sage budget add", delegate { Submit(budgetXml, password); }); }
                catch (Exception error)
                {
                    throw new EstimateAttentionException("The proposal was added but the budget wasn't: " + error.Message);
                }
            }
        }

        private static void RequireEstimateCostCodes(EstimatePayload payload)
        {
            List<ChangeOrderLine> lines = new List<ChangeOrderLine>();
            foreach (EstimateLine line in payload.proposal.lines)
                lines.Add(new ChangeOrderLine { costCodeRecordNumber = line.costCodeRecordNumber, costTypeNumber = 5 });
            if (payload.budget != null && payload.budget.lines != null)
                foreach (EstimateLine line in payload.budget.lines)
                    lines.Add(new ChangeOrderLine { costCodeRecordNumber = line.costCodeRecordNumber, costTypeNumber = 5 });
            RequireCostCodes(lines.ToArray());
        }

        private static void ReadProposal(long jobNumber, out int lineCount, out decimal total)
        {
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand("SELECT COUNT(*), ISNULL(SUM(ttlprp), 0) FROM dbo.prplin WHERE recnum=@job", connection))
            {
                command.Parameters.AddWithValue("@job", jobNumber);
                using (SqlDataReader reader = command.ExecuteReader())
                {
                    reader.Read();
                    lineCount = Convert.ToInt32(reader[0]);
                    total = Convert.ToDecimal(reader[1]);
                }
            }
        }

        private static int BudgetLineCount(long jobNumber)
        {
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo.bdglin WHERE recnum=@job", connection))
            {
                command.Parameters.AddWithValue("@job", jobNumber);
                return Convert.ToInt32(command.ExecuteScalar());
            }
        }

        // ProposalAddRq and BudgetAddRq are sequences, so elements are written in the
        // schema's order; each request is validated against the installed mbxml.xsd.
        private static string BuildProposalAddXml(string user, long jobNumber, EstimateLine[] lines)
        {
            StringBuilder body = new StringBuilder();
            AppendReference(body, "ObjectRef", jobNumber.ToString(CultureInfo.InvariantCulture));
            foreach (EstimateLine line in lines)
            {
                body.Append("<ProposalLineAdd><ObjectRef><PhaseID>0</PhaseID></ObjectRef>");
                AppendReference(body, "CostCodeRef", line.costCodeRecordNumber);
                AppendElement(body, "Desc", Truncate((line.description ?? "").Trim(), 50));
                AppendElement(body, "OtherAmount", line.otherAmount);
                string userDefined1 = Truncate((line.userDefined1 ?? "").Trim(), 50);
                if (userDefined1.Length > 0) AppendElement(body, "UserDefined1", userDefined1);
                string memo = (line.memo ?? "").Trim();
                if (memo.Length > 0) AppendElement(body, "Memo", Truncate(memo, 100));
                body.Append("</ProposalLineAdd>");
            }
            return EstimateRequestXml("ProposalAddRq", user, body.ToString());
        }

        private static string BuildBudgetAddXml(string user, long jobNumber, EstimateLine[] lines)
        {
            StringBuilder body = new StringBuilder();
            AppendReference(body, "ObjectRef", jobNumber.ToString(CultureInfo.InvariantCulture));
            foreach (EstimateLine line in lines)
            {
                body.Append("<BudgetLineAdd><ObjectRef><PhaseID>0</PhaseID></ObjectRef>");
                AppendReference(body, "CostCodeRef", line.costCodeRecordNumber);
                AppendElement(body, "OtherAmount", line.otherAmount);
                body.Append("</BudgetLineAdd>");
            }
            return EstimateRequestXml("BudgetAddRq", user, body.ToString());
        }

        private static string EstimateRequestXml(string requestName, string user, string body)
        {
            string xml = "<api:MBXML xmlns:api=\"http://sage100contractor.com/api\"><MBXMLSessionRq><Company>" + XmlEscape(TargetCompany) + "</Company><User>" + XmlEscape(user) + "</User></MBXMLSessionRq><MBXMLMsgsRq messageSetID=\"compass-estimate\" onError=\"stopOnError\"><" + requestName + " requestID=\"" + Guid.NewGuid().ToString() + "\">" + body + "</" + requestName + "></MBXMLMsgsRq></api:MBXML>";
            ValidateXml(xml);
            return xml;
        }
    }
}
