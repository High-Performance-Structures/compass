using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Xml;

namespace CompassSageClientProjectWriter
{
    // Compiled into the existing Sage bridge executable, but activated only
    // with --contact-run. The existing client/job task remains unchanged.
    internal static partial class Program
    {
        private const string ContactRequestsTarget = "/api/integrations/sage/contact-changes/requests";
        private const string ContactResultsTarget = "/api/integrations/sage/contact-changes/results";
        private const string ContactTestCompany = "HPS Test";

        public sealed class ContactEnvelope
        {
            public ContactTask[] reads { get; set; }
            public ContactTask[] writes { get; set; }
        }
        public sealed class ContactTask
        {
            public string id { get; set; }
            public string claimToken { get; set; }
            public string organizationId { get; set; }
            public string kind { get; set; }
            public string entityId { get; set; }
            public string sageRecordId { get; set; }
            public string sageRecordNumber { get; set; }
            public string parentSageRecordId { get; set; }
            public string baseRevision { get; set; }
            public ContactChange[] changes { get; set; }
        }
        public sealed class ContactChange
        {
            public string field { get; set; }
            public string before { get; set; }
            public string after { get; set; }
        }
        public sealed class ContactSnapshot
        {
            public string kind { get; set; }
            public string entityId { get; set; }
            public string sageRecordId { get; set; }
            public string sageRecordNumber { get; set; }
            public string parentSageRecordId { get; set; }
            public string revision { get; set; }
            public Dictionary<string, string> fields { get; set; }
        }
        private sealed class ContactField
        {
            public string Key;
            public string Sql;
            public string Xml;
            public ContactField(string key, string sql, string xml) { Key = key; Sql = sql; Xml = xml; }
        }
        private static readonly ContactField[] ClientCompanyFields = {
            new ContactField("addressLine1", "addrs1", "Addr1"),
            new ContactField("addressLine2", "addrs2", "Addr2"),
            new ContactField("city", "ctynme", "City"),
            new ContactField("state", "state_", "State"),
            new ContactField("postalCode", "zipcde", "PostalCode"),
            new ContactField("billingAddressLine1", "bilad1", "BillingAddr1"),
            new ContactField("billingAddressLine2", "bilad2", "BillingAddr2"),
            new ContactField("billingCity", "bilcty", "BillingCity"),
            new ContactField("billingState", "bilste", "BillingState"),
            new ContactField("billingPostalCode", "bilzip", "BillingPostalCode"),
        };
        private static readonly ContactField[] VendorCompanyFields = {
            new ContactField("ownerName", "ownnme", "OwnerName"),
            new ContactField("addressLine1", "addrs1", "Addr1"),
            new ContactField("addressLine2", "addrs2", "Addr2"),
            new ContactField("city", "ctynme", "City"),
            new ContactField("state", "state_", "State"),
            new ContactField("postalCode", "zipcde", "PostalCode"),
        };
        private static readonly ContactField[] PersonFields = {
            new ContactField("name", "cntnme", "ContactName"),
            new ContactField("title", "jobttl", "JobTitle"),
            new ContactField("phone", "phnnum", "Phone"),
            new ContactField("phoneExtension", "phnext", "Extension"),
            new ContactField("email", "e_mail", "Email"),
            new ContactField("cellPhone", "cllphn", "Mobile"),
        };
        private static readonly ContactField[] EmployeeFields = {
            new ContactField("addressLine1", "addrs1", "Addr1"),
            new ContactField("addressLine2", "addrs2", "Addr2"),
            new ContactField("city", "ctynme", "City"),
            new ContactField("state", "state_", "State"),
            new ContactField("postalCode", "zipcde", "PostalCode"),
            new ContactField("phone", "phnnum", "Phone"),
            new ContactField("cellPhone", "cllphn", "Mobile"),
            new ContactField("email", "e_mail", "Email"),
        };

        private static ContactField[] FieldsFor(string kind)
        {
            switch (kind)
            {
                case "client_company": return ClientCompanyFields;
                case "vendor_company": return VendorCompanyFields;
                case "client_person": case "vendor_person": return PersonFields;
                case "employee": return EmployeeFields;
                default: throw new InvalidOperationException("Unsupported Sage contact kind.");
            }
        }

        private static int RunContactTest()
        {
            try
            {
                ValidateContactSchema();
                Required("SAGE_API_USER"); Required("SAGE_API_PASSWORD");
                using (SqlConnection connection = OpenContactSql(ContactTestCompany))
                using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo.reccln", connection))
                    WriteLog("INFO", "HPS Test Sage client count=" + Convert.ToString(command.ExecuteScalar()));
                using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD"), ContactTestCompany)) { }
                WriteLog("INFO", "CONTACT_TEST_SCHEMA_AND_ACCESS_OK; no Sage records changed.");
                return 0;
            }
            catch (Exception error) { WriteLog("FATAL", error.Message); return 1; }
        }

        // Deliberately separate from --contact-run and never used by a scheduled task.
        // HPS Test is disposable, but the original mapped values are still restored.
        private static int RunContactWriteTest()
        {
            try
            {
                if (!String.Equals(Environment.GetEnvironmentVariable("SAGE_CONTACT_TEST_WRITES_ENABLED"),
                    "true", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("HPS Test contact writes require the explicit local test switch.");
                ValidateContactSchema();
                string user = Required("SAGE_API_USER");
                string password = Required("SAGE_API_PASSWORD");
                string[] kinds = { "client_company", "vendor_company", "client_person", "vendor_person", "employee" };
                using (new ApiSession(user, password, ContactTestCompany))
                {
                    foreach (string kind in kinds)
                    {
                        string field = kind == "client_person" || kind == "vendor_person" ? "name" : "city";
                        ContactTask task = FindContactTestRecord(kind, field);
                        ContactSnapshot before = QueryContact(ContactTestCompany, task);
                        string marker = kind == "client_person" || kind == "vendor_person"
                            ? "Compass QA " + Guid.NewGuid().ToString("N").Substring(0, 8)
                            : "QA" + Guid.NewGuid().ToString("N").Substring(0, 8);
                        bool submitted = false;
                        try
                        {
                            ContactChange[] change = { new ContactChange {
                                field = field, before = before.fields[field], after = marker
                            } };
                            submitted = true; // A failed response may still follow a committed Sage write.
                            Submit(BuildContactXml(kind, Convert.ToInt32(before.sageRecordNumber),
                                ContactParentNumber(ContactTestCompany, task), change, ContactTestCompany), password);
                            ContactSnapshot written = QueryContact(ContactTestCompany, task);
                            if (!String.Equals(written.fields[field], marker, StringComparison.Ordinal))
                                throw new InvalidOperationException("HPS Test Sage API write did not read back on the exact selected record.");
                        }
                        finally
                        {
                            if (submitted)
                            {
                                ContactSnapshot current = QueryContact(ContactTestCompany, task);
                                List<ContactChange> restore = ContactRestoreChanges(before, current);
                                if (restore.Count > 0)
                                    Submit(BuildContactXml(kind, Convert.ToInt32(before.sageRecordNumber),
                                        ContactParentNumber(ContactTestCompany, task), restore.ToArray(), ContactTestCompany), password);
                                ContactSnapshot restored = QueryContact(ContactTestCompany, task);
                                if (ContactRestoreChanges(before, restored).Count > 0)
                                    throw new InvalidOperationException("HPS Test contact restoration did not verify; inspect this record before another test.");
                            }
                        }
                        WriteLog("INFO", "HPS Test contact write/readback/restore passed: " + kind);
                    }
                }
                WriteLog("INFO", "CONTACT_WRITE_TEST_OK; original mapped values restored.");
                return 0;
            }
            catch (Exception error) { WriteLog("FATAL", error.Message); return 1; }
        }

        private static List<ContactChange> ContactRestoreChanges(ContactSnapshot before, ContactSnapshot current)
        {
            List<ContactChange> changes = new List<ContactChange>();
            foreach (KeyValuePair<string, string> field in before.fields)
                if (!String.Equals(field.Value ?? "", current.fields[field.Key] ?? "", StringComparison.Ordinal))
                    changes.Add(new ContactChange { field = field.Key, before = current.fields[field.Key], after = field.Value });
            return changes;
        }

        private static ContactTask FindContactTestRecord(string kind, string fieldKey)
        {
            string table = kind == "client_company" ? "reccln" : kind == "vendor_company" ? "actpay" :
                kind == "client_person" ? "clncnt" : kind == "vendor_person" ? "vndcnt" : "employ";
            bool person = kind == "client_person" || kind == "vendor_person";
            string numberColumn = person ? "linnum" : "recnum";
            string column = null;
            foreach (ContactField field in FieldsFor(kind))
                if (field.Key == fieldKey) column = field.Sql;
            if (column == null) throw new InvalidOperationException("Unsupported HPS Test field.");
            // A single-contact parent prevents an ambiguous child-line write from
            // silently changing another person during this LineID validation.
            string query = "SELECT TOP (1) c._idnum, c." + numberColumn + ", " +
                (person ? "c._idref" : "NULL") + " FROM dbo." + table + " c WHERE c." + numberColumn +
                " > 0 AND NULLIF(LTRIM(RTRIM(c." + column + ")), '') IS NOT NULL" +
                (person ? " AND (SELECT COUNT(*) FROM dbo." + table + " sibling WHERE sibling._idref = c._idref) = 1" : "") +
                " ORDER BY c." + numberColumn;
            using (SqlConnection connection = OpenContactSql(ContactTestCompany))
            using (SqlCommand command = new SqlCommand(query, connection))
            using (SqlDataReader reader = command.ExecuteReader())
            {
                if (!reader.Read()) throw new InvalidOperationException("HPS Test has no eligible " + kind + " record.");
                return new ContactTask {
                    kind = kind, sageRecordId = Convert.ToString(reader[0]),
                    sageRecordNumber = Convert.ToString(reader[1]),
                    parentSageRecordId = reader.IsDBNull(2) ? null : Convert.ToString(reader[2])
                };
            }
        }

        private static int RunContactSchemaTest()
        {
            try
            {
                ValidateContactSchema();
                WriteLog("INFO", "CONTACT_SCHEMA_OK; no Sage records changed.");
                return 0;
            }
            catch (Exception error) { WriteLog("FATAL", error.Message); return 1; }
        }

        private static void ValidateContactSchema()
        {
            foreach (string kind in new string[] { "client_company", "client_person", "vendor_company", "vendor_person", "employee" })
            {
                ContactField[] fields = FieldsFor(kind);
                ContactChange[] changes = new ContactChange[fields.Length];
                for (int index = 0; index < fields.Length; index++)
                {
                    string key = fields[index].Key;
                    changes[index] = new ContactChange { field = key, before = null,
                        after = key == "state" || key == "billingState" ? "CO" :
                            key == "postalCode" || key == "billingPostalCode" ? "80000" :
                            key == "email" ? "test@example.invalid" :
                            key == "phone" || key == "cellPhone" ? "5550100" : "Test" };
                }
                ValidateContactXml(kind, 1, 1, changes, ContactTestCompany);
            }
        }

        private static int RunContactBridge()
        {
            try
            {
                Required("COMPASS_BASE_URL"); Required("SAGE_CONTACT_BRIDGE_SECRET");
                Required("SAGE_API_USER"); Required("SAGE_API_PASSWORD");
                Required("SAGE_CONTACT_ORGANIZATION_ID");
                if (!String.Equals(Environment.GetEnvironmentVariable("SAGE_SQL_DATABASE") ?? TargetCompany,
                    TargetCompany, StringComparison.Ordinal))
                    throw new InvalidOperationException("Contact bridge must use the approved production Sage company.");
                string json = SendContact("GET", ContactRequestsTarget, "");
                ContactEnvelope envelope = Json.Deserialize<ContactEnvelope>(json);
                if (envelope == null) throw new InvalidOperationException("Compass returned no contact queue envelope.");
                foreach (ContactTask read in envelope.reads ?? new ContactTask[0])
                    ProcessContactTask(read, false);
                if (envelope.writes != null && envelope.writes.Length > 0 &&
                    !String.Equals(Environment.GetEnvironmentVariable("SAGE_CONTACT_WRITES_ENABLED"), "true", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Local Sage contact write switch is disabled.");
                foreach (ContactTask write in envelope.writes ?? new ContactTask[0])
                    ProcessContactTask(write, true);
                return 0;
            }
            catch (Exception error) { WriteLog("FATAL", error.Message); return 1; }
        }

        private static void ProcessContactTask(ContactTask task, bool write)
        {
            if (task == null || String.IsNullOrWhiteSpace(task.id) || String.IsNullOrWhiteSpace(task.claimToken))
                throw new InvalidOperationException("Sage contact claim is incomplete.");
            if (!String.Equals(task.organizationId, Required("SAGE_CONTACT_ORGANIZATION_ID"), StringComparison.Ordinal))
                throw new InvalidOperationException("Sage contact claim targets the wrong Compass organization.");
            string type = write ? "write" : "read";
            try
            {
                ContactSnapshot before = QueryContact(TargetCompany, task);
                if (!write)
                {
                    PostContactResult(type, task, before, null);
                    return;
                }
                if (task.changes == null || task.changes.Length == 0)
                    throw new InvalidOperationException("Approved proposal has no changes.");
                if (!String.Equals(before.sageRecordId, task.sageRecordId, StringComparison.Ordinal) ||
                    !String.Equals(before.parentSageRecordId ?? "", task.parentSageRecordId ?? "", StringComparison.Ordinal))
                    throw new InvalidOperationException("Sage contact identity changed before write.");
                bool alreadyApplied = true;
                foreach (ContactChange change in task.changes)
                {
                    if (!before.fields.ContainsKey(change.field))
                        throw new InvalidOperationException("Approved proposal contains an unsupported field.");
                    if (!String.Equals(before.fields[change.field] ?? "", change.after ?? "", StringComparison.Ordinal))
                        alreadyApplied = false;
                }
                if (!alreadyApplied)
                {
                    if (!String.Equals(before.revision, task.baseRevision, StringComparison.Ordinal))
                        throw new InvalidOperationException("Sage contact changed since the approved snapshot; no write attempted.");
                    foreach (ContactChange change in task.changes)
                        if (!String.Equals(before.fields[change.field] ?? "", change.before ?? "", StringComparison.Ordinal))
                            throw new InvalidOperationException("Approved before-value differs from Sage; no write attempted.");
                    string xml = BuildContactXml(task.kind, Convert.ToInt32(before.sageRecordNumber),
                        ContactParentNumber(TargetCompany, task), task.changes, TargetCompany);
                    using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD")))
                        Submit(xml, Required("SAGE_API_PASSWORD"));
                }
                ContactSnapshot after = QueryContact(TargetCompany, task);
                PostContactResult(type, task, after, null);
            }
            catch (Exception error)
            {
                WriteLog("ERROR", "Contact " + task.id + " failed: " + error.Message);
                PostContactResult(type, task, null, error.Message);
            }
        }

        private static SqlConnection OpenContactSql(string company)
        {
            if (company != TargetCompany && company != ContactTestCompany)
                throw new InvalidOperationException("Unapproved Sage company.");
            string configured = company == TargetCompany ? Environment.GetEnvironmentVariable("SAGE_SQL_CONNECTION_STRING") : null;
            string connectionString = String.IsNullOrWhiteSpace(configured)
                ? "Data Source=" + DataSource() + ";Initial Catalog=" + company + ";Integrated Security=True;Application Name=Compass.Sage.ContactWriter;TrustServerCertificate=True"
                : configured;
            SqlConnection connection = new SqlConnection(connectionString);
            connection.Open();
            using (SqlCommand command = new SqlCommand("SELECT DB_NAME()", connection))
                if (!String.Equals(Convert.ToString(command.ExecuteScalar()), company, StringComparison.Ordinal))
                {
                    connection.Dispose();
                    throw new InvalidOperationException("Sage SQL connection resolved to the wrong company.");
                }
            return connection;
        }

        private static ContactSnapshot QueryContact(string company, ContactTask task)
        {
            ContactField[] fields = FieldsFor(task.kind);
            bool person = task.kind == "client_person" || task.kind == "vendor_person";
            string table = task.kind == "client_company" ? "reccln" :
                task.kind == "vendor_company" ? "actpay" :
                task.kind == "client_person" ? "clncnt" :
                task.kind == "vendor_person" ? "vndcnt" : "employ";
            string idColumn = person ? "linnum" : "recnum";
            StringBuilder query = new StringBuilder("SELECT _idnum, ").Append(idColumn).Append(", ")
                .Append(person ? "_idref" : "NULL");
            foreach (ContactField field in fields) query.Append(", ").Append(field.Sql);
            query.Append(" FROM dbo.").Append(table)
                .Append(" WHERE ((@id IS NOT NULL AND _idnum = @id) OR (@id IS NULL AND ")
                .Append(idColumn).Append(" = @number))");
            if (person) query.Append(" AND _idref = @parent");
            using (SqlConnection connection = OpenContactSql(company))
            using (SqlCommand command = new SqlCommand(query.ToString(), connection))
            {
                command.Parameters.AddWithValue("@id", String.IsNullOrWhiteSpace(task.sageRecordId) ? (object)DBNull.Value : task.sageRecordId);
                command.Parameters.AddWithValue("@number", String.IsNullOrWhiteSpace(task.sageRecordNumber) ? (object)DBNull.Value : task.sageRecordNumber);
                if (person) command.Parameters.AddWithValue("@parent", task.parentSageRecordId ?? "");
                using (SqlDataReader reader = command.ExecuteReader())
                {
                    if (!reader.Read()) throw new InvalidOperationException("Sage contact record was not found by its exact key.");
                    ContactSnapshot snapshot = new ContactSnapshot {
                        kind = task.kind, entityId = task.entityId,
                        sageRecordId = Convert.ToString(reader[0]),
                        sageRecordNumber = Convert.ToString(reader[1]),
                        parentSageRecordId = reader.IsDBNull(2) ? null : Convert.ToString(reader[2]),
                        fields = new Dictionary<string, string>(StringComparer.Ordinal)
                    };
                    for (int index = 0; index < fields.Length; index++)
                        snapshot.fields.Add(fields[index].Key, reader.IsDBNull(index + 3) ? null : Convert.ToString(reader[index + 3]).Trim());
                    if (reader.Read()) throw new InvalidOperationException("Sage contact key resolved more than one row.");
                    snapshot.revision = ContactRevision(snapshot);
                    return snapshot;
                }
            }
        }

        private static string ContactRevision(ContactSnapshot snapshot)
        {
            List<string> keys = new List<string>(snapshot.fields.Keys);
            keys.Sort(StringComparer.Ordinal);
            StringBuilder canonical = new StringBuilder(snapshot.kind).Append('|').Append(snapshot.sageRecordId)
                .Append('|').Append(snapshot.parentSageRecordId ?? "");
            foreach (string key in keys) canonical.Append('|').Append(key.Length).Append(':').Append(key)
                .Append('=').Append(snapshot.fields[key] == null ? "<null>" : snapshot.fields[key].Length + ":" + snapshot.fields[key]);
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(canonical.ToString()));
                StringBuilder hex = new StringBuilder();
                foreach (byte value in hash) hex.Append(value.ToString("x2"));
                return hex.ToString();
            }
        }

        private static int ContactParentNumber(string company, ContactTask task)
        {
            if (task.kind != "client_person" && task.kind != "vendor_person") return 0;
            string table = task.kind == "client_person" ? "reccln" : "actpay";
            using (SqlConnection connection = OpenContactSql(company))
            using (SqlCommand command = new SqlCommand("SELECT recnum FROM dbo." + table + " WHERE _idnum = @id", connection))
            {
                command.Parameters.AddWithValue("@id", task.parentSageRecordId ?? "");
                object value = command.ExecuteScalar();
                if (value == null || value == DBNull.Value) throw new InvalidOperationException("Sage parent company was not found.");
                return Convert.ToInt32(value);
            }
        }

        private static void ValidateContactXml(string kind, int recordNumber, int parentNumber, ContactChange[] changes, string company)
        {
            BuildContactXml(kind, recordNumber, parentNumber, changes, company);
        }

        private static string BuildContactXml(string kind, int recordNumber, int parentNumber, ContactChange[] changes, string company)
        {
            if (recordNumber < 1) throw new InvalidOperationException("Sage contact number is invalid.");
            ContactField[] allowed = FieldsFor(kind);
            Dictionary<string, string> proposed = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (ContactChange change in changes)
            {
                bool known = false;
                foreach (ContactField field in allowed) if (field.Key == change.field) known = true;
                if (!known || proposed.ContainsKey(change.field))
                    throw new InvalidOperationException("Unknown or duplicate Sage contact field.");
                proposed.Add(change.field, change.after);
            }
            bool person = kind == "client_person" || kind == "vendor_person";
            if (person && parentNumber < 1) throw new InvalidOperationException("Sage person parent number is invalid.");
            string requestName = kind == "client_company" || kind == "client_person" ? "ClientModRq" :
                kind == "vendor_company" || kind == "vendor_person" ? "VendorModRq" : "EmployeeModRq";
            StringBuilder body = new StringBuilder("<ObjectRef><ObjectID>")
                .Append(person ? parentNumber : recordNumber).Append("</ObjectID></ObjectRef>");
            if (person) body.Append(kind == "client_person" ? "<ClientContactMod>" : "<VendorContactMod>")
                .Append("<ObjectRef><LineID>").Append(recordNumber).Append("</LineID></ObjectRef>");
            foreach (ContactField field in allowed)
                if (proposed.ContainsKey(field.Key)) body.Append('<').Append(field.Xml).Append('>')
                    .Append(XmlEscape(proposed[field.Key] ?? "")).Append("</").Append(field.Xml).Append('>');
            if (person) body.Append(kind == "client_person" ? "</ClientContactMod>" : "</VendorContactMod>");
            string xml = "<api:MBXML xmlns:api=\"http://sage100contractor.com/api\"><MBXMLSessionRq><Company>" +
                XmlEscape(company) + "</Company><User>" + XmlEscape(Required("SAGE_API_USER")) +
                "</User></MBXMLSessionRq><MBXMLMsgsRq messageSetID=\"compass-contact\" onError=\"stopOnError\"><" +
                requestName + " requestID=\"" + Guid.NewGuid().ToString() + "\">" + body + "</" + requestName +
                "></MBXMLMsgsRq></api:MBXML>";
            ValidateXml(xml);
            return xml;
        }

        private static void PostContactResult(string type, ContactTask task, ContactSnapshot snapshot, string error)
        {
            Dictionary<string, object> result = new Dictionary<string, object> {
                { "id", task.id }, { "claimToken", task.claimToken },
                { "outcome", error == null ? "succeeded" : "failed" }
            };
            if (error == null) result.Add("snapshot", snapshot);
            else result.Add("error", Truncate(error, 1000));
            SendContact("POST", ContactResultsTarget, Json.Serialize(new Dictionary<string, object> {
                { "type", type }, { "result", result }
            }));
        }

        private static string SendContact(string method, string target, string body)
        {
            string baseUrl = Required("COMPASS_BASE_URL").TrimEnd('/');
            Uri destination;
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out destination) ||
                !String.Equals(destination.Scheme, "https", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Compass contact bridge requires an HTTPS base URL.");
            string timestamp = Convert.ToInt64((DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds).ToString();
            string requestId = Guid.NewGuid().ToString();
            string signature = Sign(Required("SAGE_CONTACT_BRIDGE_SECRET"),
                timestamp + "." + requestId + "." + method + "." + target + "." + body);
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(baseUrl + target);
            request.Method = method; request.Timeout = 60000; request.ReadWriteTimeout = 60000;
            request.Headers["x-compass-timestamp"] = timestamp;
            request.Headers["x-compass-request-id"] = requestId;
            request.Headers["x-compass-signature"] = "sha256=" + signature;
            if (method == "POST")
            {
                byte[] bytes = Encoding.UTF8.GetBytes(body);
                request.ContentType = "application/json"; request.ContentLength = bytes.Length;
                using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
            }
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                return reader.ReadToEnd();
        }
    }
}
