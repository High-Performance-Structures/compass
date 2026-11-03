using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Text;

// Vendor certificates → Sage, as part of the approved Compass Sage writer
// (Sage's API approval belongs to that one installed program). Compass keeps
// each linked vendor's Certificates (4-4 Vendors → Options → Certificates)
// matched to the trade docs on file in Compass: description, received and
// expiry dates, Warning and Stop Pay. A row Compass recognises (by its
// description) is updated; a missing one is added; a second row for the same
// document gets its Warning and Stop Pay turned off; rows Compass doesn't
// recognise are left alone. It also sends Sage's vendor list to Compass once
// a day, so staff can link vendors in bulk.
//
// Switches (machine environment): SAGE_VENDOR_CERTIFICATE_WRITES_ENABLED=true
// runs it after each writer run; SAGE_VENDOR_CERTIFICATE_DRY_RUN=true plans
// every sync and reports the plan to Compass as a failure, writing nothing.
namespace CompassSageClientProjectWriter
{
    internal static partial class Program
    {
        private const string CertificateRequestsTarget = "/api/integrations/sage/vendor-certificates/requests?limit=5";
        private const string CertificateResultsTarget = "/api/integrations/sage/vendor-certificates/results";
        private const string CertificateDirectoryTarget = "/api/integrations/sage/vendor-certificates/directory";

        public sealed class CertificateEnvelope
        {
            public string organizationId { get; set; }
            public bool directoryWanted { get; set; }
            public CertificateRequest[] requests { get; set; }
        }
        public sealed class CertificateRequest
        {
            public string id { get; set; }
            public string claimToken { get; set; }
            public CertificatePayload payload { get; set; }
        }
        public sealed class CertificatePayload
        {
            public string operationType { get; set; }
            public string organizationId { get; set; }
            public string vendorId { get; set; }
            public string vendorName { get; set; }
            public string sageRecordId { get; set; }
            public string sageVendorNumber { get; set; }
            public CertificateLine[] certificates { get; set; }
        }
        public sealed class CertificateLine
        {
            public string docTypeId { get; set; }
            public string desc { get; set; }
            public string[] matchNames { get; set; }
            public string receivedDate { get; set; }
            public string expiryDate { get; set; }
            public string warn { get; set; }
            public string stopPay { get; set; }
            public string memo { get; set; }
        }

        /// <summary>One certificate row as Sage has it now.</summary>
        private sealed class SageCertificate
        {
            public int LineId;
            public string Desc;
            public string Received;
            public string Expiry;
            public string Warn;
            public string StopPay;
            public bool JobSpecific;
        }

        private sealed class CertificatePlan
        {
            public CertificateRequest Request;
            public int VendorNumber;
            public string Xml;
            public List<string> Changes = new List<string>();
            public List<Dictionary<string, object>> Lines = new List<Dictionary<string, object>>();
            public List<int> Superseded = new List<int>();
        }

        private static bool VendorCertificateWritesEnabled()
        {
            return String.Equals(Environment.GetEnvironmentVariable("SAGE_VENDOR_CERTIFICATE_WRITES_ENABLED"), "true", StringComparison.OrdinalIgnoreCase);
        }

        private static bool VendorCertificateDryRun()
        {
            return String.Equals(Environment.GetEnvironmentVariable("SAGE_VENDOR_CERTIFICATE_DRY_RUN"), "true", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Runs after the other writer steps, as a fresh child process
        /// (--vendor-certificate-run), for the same reason as Square fees: one
        /// Sage API session per process. A problem is logged and never fails
        /// the client/project writer.
        /// </summary>
        private static void RunVendorCertificatesAfterWriterRun()
        {
            if (!VendorCertificateWritesEnabled()) return;
            try
            {
                ProcessStartInfo start = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "--vendor-certificate-run")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using (System.Diagnostics.Process child = System.Diagnostics.Process.Start(start))
                {
                    if (child == null) throw new InvalidOperationException("Could not start the vendor certificate run.");
                    if (!child.WaitForExit(5 * 60 * 1000))
                    {
                        WriteLog("ERROR", "Vendor certificate run is still going after 5 minutes; leaving it to finish.");
                        return;
                    }
                    if (child.ExitCode != 0) WriteLog("ERROR", "Vendor certificate run exited with code " + child.ExitCode + ".");
                }
            }
            catch (Exception error) { WriteLog("ERROR", "Vendor certificate run failed to start: " + Detail(error)); }
        }

        /// <summary>--vendor-certificate-run: vendor list and certificate syncs only.</summary>
        private static int RunVendorCertificatesOnly()
        {
            try
            {
                if (!VendorCertificateWritesEnabled()) throw new InvalidOperationException("SAGE_VENDOR_CERTIFICATE_WRITES_ENABLED is off.");
                Required("COMPASS_BASE_URL"); Required("SAGE_BRIDGE_SECRET"); Required("SAGE_API_USER"); Required("SAGE_API_PASSWORD");
                PollVendorCertificates();
                return 0;
            }
            catch (Exception error)
            {
                WriteLog("ERROR", "Vendor certificate run failed: " + Detail(error));
                return 1;
            }
        }

        /// <summary>
        /// --vendor-certificate-diagnose: no writes. Prints the certificate
        /// table's columns and how many rows it has, validates a sample Add and
        /// Mod against the installed schema, and signs in to the Sage API.
        /// </summary>
        private static int RunVendorCertificateDiagnostics()
        {
            try
            {
                Required("SAGE_API_USER"); Required("SAGE_API_PASSWORD");
                StringBuilder columns = new StringBuilder();
                using (SqlConnection connection = OpenSql())
                {
                    using (SqlCommand command = new SqlCommand("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'vndcrt' ORDER BY ORDINAL_POSITION", connection))
                    using (SqlDataReader reader = command.ExecuteReader())
                        while (reader.Read()) columns.Append(columns.Length == 0 ? "" : ",").Append(Convert.ToString(reader[0]));
                    using (SqlCommand count = new SqlCommand("SELECT COUNT(*) FROM dbo.vndcrt", connection))
                        columns.Append(" rows=").Append(Convert.ToString(count.ExecuteScalar()));
                    // The descriptions staff already use, so Compass can be given the same names.
                    using (SqlCommand names = new SqlCommand("SELECT TOP 20 LTRIM(RTRIM(dscrpt)) AS d, COUNT(*) AS n, SUM(CASE WHEN stppay = 'Y' THEN 1 ELSE 0 END) AS s FROM dbo.vndcrt GROUP BY LTRIM(RTRIM(dscrpt)) ORDER BY COUNT(*) DESC", connection))
                    using (SqlDataReader reader = names.ExecuteReader())
                    {
                        columns.Append(" descriptions=");
                        while (reader.Read()) columns.Append('[').Append(Convert.ToString(reader["d"])).Append(" x").Append(Convert.ToString(reader["n"])).Append(" stop=").Append(Convert.ToString(reader["s"])).Append(']');
                    }
                }
                CertificateLine sample = new CertificateLine { desc = "Compass diagnostic", receivedDate = "2026-01-01", expiryDate = "2026-12-31", warn = "Y", stopPay = "N", memo = "Schema validation only" };
                StringBuilder children = new StringBuilder();
                AppendCertificateAdd(children, sample);
                AppendCertificateMod(children, 1, sample, true);
                BuildVendorCertificateXml(1, children.ToString());
                using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD"))) { }
                WriteLog("INFO", "VENDOR_CERTIFICATE_DIAGNOSTIC_OK columns=" + columns);
                Console.WriteLine("VENDOR_CERTIFICATE_DIAGNOSTIC_OK columns=" + columns);
                return 0;
            }
            catch (Exception error)
            {
                WriteLog("FATAL", "Vendor certificate diagnostic failed: " + Detail(error));
                Console.WriteLine("VENDOR_CERTIFICATE_DIAGNOSTIC_FAILED " + error.Message);
                return 1;
            }
        }

        private static void PollVendorCertificates()
        {
            string json;
            try { json = Send("GET", CertificateRequestsTarget, ""); }
            catch (BridgeRequestException error)
            {
                // Compass answers 503 while the sync is switched off there.
                if (error.Message.Contains("(503")) return;
                throw;
            }
            CertificateEnvelope envelope = Json.Deserialize<CertificateEnvelope>(json);
            if (envelope == null) return;
            if (envelope.directoryWanted && !String.IsNullOrWhiteSpace(envelope.organizationId))
            {
                try { PostVendorDirectory(envelope.organizationId); }
                catch (Exception error) { WriteLog("ERROR", "Sage vendor list was not sent: " + Detail(error)); }
            }
            CertificateRequest[] requests = envelope.requests ?? new CertificateRequest[0];
            if (requests.Length == 0) return;

            bool dryRun = VendorCertificateDryRun();
            List<CertificatePlan> toWrite = new List<CertificatePlan>();
            foreach (CertificateRequest request in requests)
            {
                try
                {
                    CertificatePlan plan = PlanCertificates(request);
                    if (dryRun)
                    {
                        PostCertificateFailure(request, "Dry run, nothing written. Plan: " + (plan.Changes.Count == 0 ? "no changes" : String.Join("; ", plan.Changes.ToArray())));
                        continue;
                    }
                    if (plan.Xml == null) PostCertificateSuccess(plan);
                    else toWrite.Add(plan);
                }
                catch (Exception error) { PostCertificateFailure(request, error.Message); }
            }
            if (toWrite.Count == 0) return;

            Dictionary<string, Exception> writeErrors = new Dictionary<string, Exception>();
            using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD")))
            {
                foreach (CertificatePlan plan in toWrite)
                {
                    try { Submit(plan.Xml, Required("SAGE_API_PASSWORD")); }
                    catch (Exception error) { writeErrors[plan.Request.id] = error; }
                }
            }
            // Sage commits when the session closes; check every vendor's rows before reporting success.
            foreach (CertificatePlan plan in toWrite)
            {
                Exception error;
                if (writeErrors.TryGetValue(plan.Request.id, out error)) { PostCertificateFailure(plan.Request, error.Message); continue; }
                try
                {
                    ConfirmCertificates(plan);
                    PostCertificateSuccess(plan);
                    WriteLog("INFO", "Vendor certificates " + plan.Request.id + " SUCCEEDED vendor=" + plan.VendorNumber + " " + String.Join("; ", plan.Changes.ToArray()));
                }
                catch (Exception readError) { PostCertificateFailure(plan.Request, "Written but not confirmed in Sage: " + readError.Message); }
            }
        }

        private static void PostVendorDirectory(string organizationId)
        {
            List<Dictionary<string, object>> entries = new List<Dictionary<string, object>>();
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand("SELECT _idnum, recnum, vndnme, prmeml FROM dbo.actpay ORDER BY recnum", connection))
            using (SqlDataReader reader = command.ExecuteReader())
            {
                while (reader.Read())
                {
                    if (entries.Count >= 5000) throw new InvalidOperationException("Sage's vendor list is larger than Compass accepts.");
                    Guid id;
                    int number;
                    string name = reader.IsDBNull(2) ? "" : Convert.ToString(reader[2]).Trim();
                    if (reader.IsDBNull(0) || !Guid.TryParse(Convert.ToString(reader[0]), out id)) continue;
                    if (reader.IsDBNull(1) || !Int32.TryParse(Convert.ToString(reader[1]), NumberStyles.None, CultureInfo.InvariantCulture, out number) || number <= 0) continue;
                    if (name.Length == 0) continue;
                    string email = reader.IsDBNull(3) ? null : Convert.ToString(reader[3]).Trim();
                    entries.Add(new Dictionary<string, object> {
                        { "sageRecordId", id.ToString() }, { "sageVendorNumber", number.ToString(CultureInfo.InvariantCulture) },
                        { "name", Truncate(name, 200) }, { "email", String.IsNullOrEmpty(email) ? null : Truncate(email, 255) } });
                }
            }
            if (entries.Count == 0) return;
            Send("POST", CertificateDirectoryTarget, Json.Serialize(new Dictionary<string, object> { { "organizationId", organizationId }, { "entries", entries } }));
            WriteLog("INFO", "Sent Sage's vendor list to Compass: " + entries.Count + " vendors.");
        }

        private static int ValidateCertificatePayload(CertificateRequest request)
        {
            if (request == null || request.payload == null || request.payload.certificates == null) throw new InvalidOperationException("Compass payload is incomplete.");
            CertificatePayload payload = request.payload;
            if (!String.Equals(payload.operationType, "sync_vendor_certificates", StringComparison.Ordinal))
                throw new InvalidOperationException("Only vendor certificate syncs are handled here.");
            int number;
            Guid id;
            if (!Int32.TryParse(payload.sageVendorNumber, NumberStyles.None, CultureInfo.InvariantCulture, out number) || number <= 0 || !Guid.TryParse(payload.sageRecordId, out id))
                throw new InvalidOperationException("The Sage vendor number or id is missing.");
            // The vendor must still be the one Compass linked: same record id and number.
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand("SELECT recnum FROM dbo.actpay WHERE _idnum = @id", connection))
            {
                command.Parameters.AddWithValue("@id", id);
                object found = command.ExecuteScalar();
                if (found == null || found == DBNull.Value) throw new InvalidOperationException("Sage vendor " + number + " was not found.");
                if (Convert.ToInt32(found, CultureInfo.InvariantCulture) != number)
                    throw new InvalidOperationException("Sage vendor record " + payload.sageRecordId + " is now number " + found + ", not " + number + ". Relink the vendor in Compass.");
            }
            foreach (CertificateLine line in payload.certificates)
            {
                if (line == null || String.IsNullOrWhiteSpace(line.desc) || line.desc.Length > 50 || line.matchNames == null || line.matchNames.Length == 0)
                    throw new InvalidOperationException("A certificate row from Compass is incomplete.");
                if (!IsYesNo(line.warn) || !IsYesNo(line.stopPay)) throw new InvalidOperationException("Warning and Stop Pay must be Y or N.");
                if (!IsDateOrNull(line.receivedDate) || !IsDateOrNull(line.expiryDate)) throw new InvalidOperationException("A certificate date from Compass is not a date.");
            }
            return number;
        }

        private static bool IsYesNo(string value) { return value == "Y" || value == "N"; }

        private static bool IsDateOrNull(string value)
        {
            DateTime ignored;
            return value == null || DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out ignored);
        }

        /// <summary>
        /// The vendor's certificate rows. Sage keys child rows to the vendor by
        /// _idref (the vendor's _idnum) on newer tables and by recnum on older
        /// ones; read whichever this table has, and the columns by name.
        /// </summary>
        private static List<SageCertificate> ReadCertificates(Guid vendorId, int vendorNumber)
        {
            List<SageCertificate> rows = new List<SageCertificate>();
            using (SqlConnection connection = OpenSql())
            {
                HashSet<string> columns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                using (SqlCommand command = new SqlCommand("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'vndcrt'", connection))
                using (SqlDataReader reader = command.ExecuteReader())
                    while (reader.Read()) columns.Add(Convert.ToString(reader[0]));
                string key = columns.Contains("_idref") ? "_idref" : "recnum";
                string line = columns.Contains("linnum") ? "linnum" : null;
                string desc = FirstColumn(columns, "dscrpt", "crtdsc", "crtnme");
                string received = FirstColumn(columns, "dtercv", "rcvdte", "recdte", "dterec", "datrcv");
                string job = FirstColumn(columns, "jobnum", "jobref");
                if (line == null || desc == null || !columns.Contains("expdte") || !columns.Contains("cntwrn") || !columns.Contains("stppay"))
                    throw new InvalidOperationException("Sage's certificate table doesn't have the expected columns. Run --vendor-certificate-diagnose.");
                string sql = "SELECT " + line + " AS line, " + desc + " AS dsc, expdte, cntwrn, stppay" +
                    (received == null ? ", NULL AS rcv" : ", " + received + " AS rcv") + (job == null ? ", NULL AS job" : ", " + job + " AS job") +
                    " FROM dbo.vndcrt WHERE " + key + " = @vendor ORDER BY " + line;
                using (SqlCommand command = new SqlCommand(sql, connection))
                {
                    if (key == "_idref") command.Parameters.AddWithValue("@vendor", vendorId);
                    else command.Parameters.AddWithValue("@vendor", vendorNumber);
                    using (SqlDataReader reader = command.ExecuteReader())
                        while (reader.Read())
                            rows.Add(new SageCertificate {
                                LineId = Convert.ToInt32(reader["line"], CultureInfo.InvariantCulture),
                                Desc = reader["dsc"] == DBNull.Value ? "" : Convert.ToString(reader["dsc"]).Trim(),
                                Expiry = DateText(reader["expdte"]),
                                Received = DateText(reader["rcv"]),
                                Warn = YesNoText(reader["cntwrn"]),
                                StopPay = YesNoText(reader["stppay"]),
                                JobSpecific = reader["job"] != DBNull.Value && Convert.ToString(reader["job"]).Trim().Length > 0 && Convert.ToString(reader["job"]).Trim() != "0",
                            });
                }
            }
            return rows;
        }

        private static string FirstColumn(HashSet<string> columns, params string[] names)
        {
            foreach (string name in names) if (columns.Contains(name)) return name;
            return null;
        }

        private static string DateText(object value)
        {
            if (value == null || value == DBNull.Value) return null;
            return Convert.ToDateTime(value, CultureInfo.InvariantCulture).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        private static string YesNoText(object value)
        {
            string text = value == null || value == DBNull.Value ? "" : Convert.ToString(value).Trim().ToUpperInvariant();
            return text == "Y" || text == "1" || text == "TRUE" ? "Y" : "N";
        }

        private static bool Matches(SageCertificate row, CertificateLine line)
        {
            string desc = (row.Desc ?? "").Trim().ToLowerInvariant();
            foreach (string name in line.matchNames) if (String.Equals(desc, (name ?? "").Trim().ToLowerInvariant(), StringComparison.Ordinal)) return true;
            return false;
        }

        private static CertificatePlan PlanCertificates(CertificateRequest request)
        {
            int number = ValidateCertificatePayload(request);
            Guid vendorId = Guid.Parse(request.payload.sageRecordId);
            List<SageCertificate> existing = ReadCertificates(vendorId, number);
            CertificatePlan plan = new CertificatePlan { Request = request, VendorNumber = number };
            StringBuilder children = new StringBuilder();
            HashSet<int> used = new HashSet<int>();
            foreach (CertificateLine line in request.payload.certificates)
            {
                List<SageCertificate> found = existing.FindAll(row => !used.Contains(row.LineId) && Matches(row, line));
                if (found.Count == 0)
                {
                    AppendCertificateAdd(children, line);
                    plan.Changes.Add("add " + line.desc);
                    plan.Lines.Add(new Dictionary<string, object> { { "docTypeId", line.docTypeId }, { "lineId", 0 }, { "action", "added" } });
                    continue;
                }
                // The company-wide row with the latest expiry stands for the document.
                found.Sort((left, right) =>
                {
                    if (left.JobSpecific != right.JobSpecific) return left.JobSpecific ? 1 : -1;
                    return String.CompareOrdinal(right.Expiry ?? "", left.Expiry ?? "");
                });
                SageCertificate primary = found[0];
                used.Add(primary.LineId);
                bool differs = !String.Equals(primary.Desc, line.desc, StringComparison.Ordinal) || primary.Received != line.receivedDate ||
                    primary.Expiry != line.expiryDate || primary.Warn != line.warn || primary.StopPay != line.stopPay;
                if (differs)
                {
                    AppendCertificateMod(children, primary.LineId, line, false);
                    plan.Changes.Add("change line " + primary.LineId + " " + line.desc + " (expires " + (line.expiryDate ?? "never") + ", warn " + line.warn + ", stop " + line.stopPay + ")");
                }
                plan.Lines.Add(new Dictionary<string, object> { { "docTypeId", line.docTypeId }, { "lineId", primary.LineId }, { "action", differs ? "changed" : "unchanged" } });
                for (int index = 1; index < found.Count; index++)
                {
                    SageCertificate older = found[index];
                    used.Add(older.LineId);
                    if (older.Warn == "N" && older.StopPay == "N") continue;
                    AppendCertificateMod(children, older.LineId, new CertificateLine { warn = "N", stopPay = "N", memo = "Superseded by line " + primary.LineId + ". Kept by Compass." }, true);
                    plan.Superseded.Add(older.LineId);
                    plan.Changes.Add("turn off warning and stop on older line " + older.LineId + " " + older.Desc);
                }
            }
            if (children.Length > 0) plan.Xml = BuildVendorCertificateXml(number, children.ToString());
            return plan;
        }

        private static void AppendDate(StringBuilder body, string element, string value)
        {
            body.Append('<').Append(element).Append('>').Append(value ?? "").Append("</").Append(element).Append('>');
        }

        private static void AppendCertificateAdd(StringBuilder body, CertificateLine line)
        {
            body.Append("<VendorCertificateAdd><Desc>").Append(XmlEscape(Truncate(line.desc, 50))).Append("</Desc>");
            if (line.receivedDate != null) AppendDate(body, "ReceivedDate", line.receivedDate);
            if (line.expiryDate != null) AppendDate(body, "ExpiryDate", line.expiryDate);
            body.Append("<WillWarnExpiredCertificate>").Append(line.warn).Append("</WillWarnExpiredCertificate>");
            body.Append("<WillExpirationStopPayment>").Append(line.stopPay).Append("</WillExpirationStopPayment>");
            body.Append("<Memo>").Append(XmlEscape(line.memo ?? "")).Append("</Memo></VendorCertificateAdd>");
        }

        /// <summary>A Mod for one line; flagsOnly changes Warning, Stop Pay and Memo and keeps the rest.</summary>
        private static void AppendCertificateMod(StringBuilder body, int lineId, CertificateLine line, bool flagsOnly)
        {
            body.Append("<VendorCertificateMod><ObjectRef><LineID>").Append(lineId.ToString(CultureInfo.InvariantCulture)).Append("</LineID></ObjectRef>");
            if (!flagsOnly)
            {
                body.Append("<Desc>").Append(XmlEscape(Truncate(line.desc, 50))).Append("</Desc>");
                // An empty element clears the date in Sage (the schema's NullString).
                AppendDate(body, "ReceivedDate", line.receivedDate);
                AppendDate(body, "ExpiryDate", line.expiryDate);
            }
            body.Append("<WillWarnExpiredCertificate>").Append(line.warn).Append("</WillWarnExpiredCertificate>");
            body.Append("<WillExpirationStopPayment>").Append(line.stopPay).Append("</WillExpirationStopPayment>");
            body.Append("<Memo>").Append(XmlEscape(line.memo ?? "")).Append("</Memo></VendorCertificateMod>");
        }

        private static string BuildVendorCertificateXml(int vendorNumber, string children)
        {
            string xml = "<api:MBXML xmlns:api=\"http://sage100contractor.com/api\"><MBXMLSessionRq><Company>" + XmlEscape(TargetCompany) + "</Company><User>" +
                XmlEscape(Required("SAGE_API_USER")) + "</User></MBXMLSessionRq><MBXMLMsgsRq messageSetID=\"compass-vendor-certificates\" onError=\"stopOnError\">" +
                "<VendorModRq requestID=\"" + Guid.NewGuid().ToString() + "\"><ObjectRef><ObjectID>" + vendorNumber.ToString(CultureInfo.InvariantCulture) +
                "</ObjectID></ObjectRef>" + children + "</VendorModRq></MBXMLMsgsRq></api:MBXML>";
            ValidateXml(xml);
            return xml;
        }

        /// <summary>Reads the vendor's rows back: each Compass line is there with its dates and flags, and added lines get their ids.</summary>
        private static void ConfirmCertificates(CertificatePlan plan)
        {
            List<SageCertificate> rows = ReadCertificates(Guid.Parse(plan.Request.payload.sageRecordId), plan.VendorNumber);
            HashSet<int> used = new HashSet<int>();
            for (int index = 0; index < plan.Request.payload.certificates.Length; index++)
            {
                CertificateLine line = plan.Request.payload.certificates[index];
                Dictionary<string, object> result = plan.Lines[index];
                int lineId = Convert.ToInt32(result["lineId"], CultureInfo.InvariantCulture);
                SageCertificate row = rows.Find(item => lineId > 0 ? item.LineId == lineId :
                    !used.Contains(item.LineId) && String.Equals(item.Desc, line.desc, StringComparison.Ordinal) && item.Expiry == line.expiryDate);
                if (row == null) throw new InvalidOperationException(line.desc + " is not in Sage after the write.");
                used.Add(row.LineId);
                if (row.Expiry != line.expiryDate || row.Warn != line.warn || row.StopPay != line.stopPay)
                    throw new InvalidOperationException(line.desc + " (line " + row.LineId + ") doesn't match: expires " + (row.Expiry ?? "never") + ", warn " + row.Warn + ", stop " + row.StopPay + ".");
                result["lineId"] = row.LineId;
            }
            foreach (int lineId in plan.Superseded)
            {
                SageCertificate row = rows.Find(item => item.LineId == lineId);
                if (row == null || row.Warn != "N" || row.StopPay != "N") throw new InvalidOperationException("Older line " + lineId + " still warns or stops payment.");
            }
        }

        private static void PostCertificateSuccess(CertificatePlan plan)
        {
            foreach (Dictionary<string, object> line in plan.Lines)
                if (Convert.ToInt32(line["lineId"], CultureInfo.InvariantCulture) <= 0) throw new InvalidOperationException("An added certificate line was not confirmed.");
            Send("POST", CertificateResultsTarget, Json.Serialize(new Dictionary<string, object> {
                { "outcome", "succeeded" }, { "id", plan.Request.id }, { "claimToken", plan.Request.claimToken },
                { "lines", plan.Lines }, { "supersededLineIds", plan.Superseded } }));
        }

        private static void PostCertificateFailure(CertificateRequest request, string error)
        {
            if (request == null || String.IsNullOrEmpty(request.id) || String.IsNullOrEmpty(request.claimToken)) return;
            Send("POST", CertificateResultsTarget, Json.Serialize(new Dictionary<string, object> {
                { "outcome", "failed" }, { "id", request.id }, { "claimToken", request.claimToken }, { "error", Truncate(error, 4000) } }));
            WriteLog("ERROR", "Vendor certificates " + request.id + " FAILED " + error);
        }
    }
}
