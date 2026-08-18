using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Xml;
using System.Xml.Schema;

namespace CompassSageClientProjectWriter
{
    internal static class Program
    {
        private const string ApiDllPath = @"C:\Program Files (x86)\Sage\Sage 100 Contractor SQL\Sage.100.Contractor.Api.dll";
        private const string XsdPath = @"C:\Program Files (x86)\Sage\Sage 100 Contractor SQL\mbxml.xsd";
        private const string TargetCompany = "High Performance Structures Inc";
        private const string AppName = "Compass.Sage.ClientProjectWriter";
        private const string RequestsTarget = "/api/integrations/sage/client-project-writes/requests?limit=5";
        private const string ResultsTarget = "/api/integrations/sage/client-project-writes/results";
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static Type ImbxmlType;
        private static Type GlobalType;
        private static object ApiInstance;
        private static bool ExclusiveAccess;

        public sealed class Envelope { public WriteRequest[] requests { get; set; } }
        public sealed class WriteRequest
        {
            public string id { get; set; }
            public string claimToken { get; set; }
            public int attempt { get; set; }
            public WritePayload payload { get; set; }
        }
        public sealed class WritePayload
        {
            public string operationType { get; set; }
            public string company { get; set; }
            public ClientPayload client { get; set; }
            public JobPayload job { get; set; }
        }
        public sealed class ClientPayload
        {
            public string name { get; set; }
            public string shortName { get; set; }
            public string company { get; set; }
            public string email { get; set; }
            public string phone { get; set; }
            public string address { get; set; }
            public string billingAddress { get; set; }
            public string notes { get; set; }
            public StatusPayload status { get; set; }
        }
        public sealed class StatusPayload
        {
            public int expectedNumber { get; set; }
            public string name { get; set; }
        }
        public sealed class JobPayload
        {
            public string compassProjectNumber { get; set; }
            public string name { get; set; }
            public string shortName { get; set; }
            public string address { get; set; }
            public string statusName { get; set; }
            public string typeName { get; set; }
        }
        private sealed class SageRecord
        {
            public string Id;
            public int Number;
            public int StatusNumber;
            public int TypeNumber;
        }
        private sealed class ApiSession : IDisposable
        {
            public ApiSession(string user, string password)
            {
                Directory.SetCurrentDirectory(Path.GetDirectoryName(ApiDllPath));
                Assembly assembly = Assembly.LoadFrom(ApiDllPath);
                ImbxmlType = assembly.GetType("Sage.SMB.API.IMBXML", true);
                GlobalType = assembly.GetType("Sage.SMB.API.mbAPIGlobal", true);
                ApiInstance = Activator.CreateInstance(ImbxmlType);
                InvokeStatic("SetRqDataSource", new object[] { DataSource() });
                Invoke("SetDataSource", new object[] { DataSource() });
                Invoke("IntializeAPI", new object[0]);
                InvokeStatic("SetRqDataSource", new object[] { DataSource() });
                InvokeStatic("ResetRqAcceptState", new object[0]);
                InvokeStatic("EnableAcceptRq", new object[] { true });
                Invoke("SetDataSource", new object[] { DataSource() });
                Invoke("EnableRequests", new object[0]);
                object allowed = Invoke("IsApplicationAllowed", new object[] { user, password });
                if (!(allowed is int) || (int)allowed != 0) throw new InvalidOperationException("The Sage API application is not allowed (code " + Convert.ToString(allowed) + ").");
                object valid = Invoke("IsValidUser", new object[] { TargetCompany, user, password });
                if (!(valid is bool) || !(bool)valid) throw new InvalidOperationException("jarvis.api is not a valid Sage API user for the target company.");
                object exclusive = Invoke("GetExclusiveAccess", new object[] { TargetCompany, user, password });
                if (!(exclusive is int) || (int)exclusive != 0) throw new InvalidOperationException("Sage exclusive access is unavailable (code " + Convert.ToString(exclusive) + ").");
                ExclusiveAccess = true;
            }
            public void Dispose()
            {
                try { if (ExclusiveAccess) Invoke("ReleaseExclusiveAccess", new object[0]); }
                finally
                {
                    ExclusiveAccess = false;
                    try { Invoke("DeIntializeAPI", new object[0]); } catch { }
                    ApiInstance = null;
                }
            }
        }

        public static int Main(string[] args)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            bool once = args.Length > 0 && String.Equals(args[0], "--once", StringComparison.OrdinalIgnoreCase);
            bool diagnose = args.Length > 0 && String.Equals(args[0], "--diagnose", StringComparison.OrdinalIgnoreCase);
            try
            {
                RequireConfiguration(!diagnose);
                if (diagnose)
                {
                    RunDiagnostics();
                    return 0;
                }
                do
                {
                    PollOnce();
                    if (!once) Thread.Sleep(30000);
                } while (!once);
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(DateTimeOffset.Now.ToString("o") + " FATAL " + error.Message);
                return 1;
            }
        }

        private static void RequireConfiguration(bool requireWriteSwitch)
        {
            Required("COMPASS_BASE_URL"); Required("SAGE_BRIDGE_SECRET");
            Required("SAGE_API_USER"); Required("SAGE_API_PASSWORD");
            string database = Environment.GetEnvironmentVariable("SAGE_SQL_DATABASE") ?? TargetCompany;
            if (!String.Equals(database.Trim(), TargetCompany, StringComparison.Ordinal))
                throw new InvalidOperationException("SAGE_SQL_DATABASE must be exactly " + TargetCompany + ".");
            if (requireWriteSwitch && !String.Equals(Environment.GetEnvironmentVariable("SAGE_CLIENT_PROJECT_WRITES_ENABLED"), "true", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Local Sage write switch is disabled.");
            if (!File.Exists(ApiDllPath) || !File.Exists(XsdPath))
                throw new FileNotFoundException("The Sage API DLL or mbxml.xsd is missing.");
        }

        private static void RunDiagnostics()
        {
            string[] clientStatuses = new string[] { "Current", "Warranty", "Complete", "Inactive", "Archive", "Other" };
            for (int index = 0; index < clientStatuses.Length; index++)
            {
                int actual = ResolveCatalog("clnsts", "stsnme", clientStatuses[index]);
                int expected = index + 1;
                if (actual != expected)
                    throw new InvalidOperationException("Client status mismatch: expected " + expected + " " + clientStatuses[index] + ", but Sage resolved " + actual + ".");
            }
            int jobStatuses = CatalogCount("jobsts");
            int jobTypes = CatalogCount("jobtyp");
            if (jobStatuses < 1 || jobTypes < 1)
                throw new InvalidOperationException("Sage job status and job type catalogs must not be empty.");
            using (new ApiSession(Required("SAGE_API_USER"), Required("SAGE_API_PASSWORD"))) { }
            Console.WriteLine("DIAGNOSTIC_OK company=" + TargetCompany + " clientStatuses=6 jobStatuses=" + jobStatuses + " jobTypes=" + jobTypes + " apiUser=" + Required("SAGE_API_USER"));
        }

        private static int CatalogCount(string table)
        {
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand("SELECT COUNT(*) FROM dbo." + table, connection))
                return Convert.ToInt32(command.ExecuteScalar());
        }

        private static void PollOnce()
        {
            string json = Send("GET", RequestsTarget, "");
            Envelope envelope = Json.Deserialize<Envelope>(json);
            WriteRequest[] requests = envelope == null || envelope.requests == null ? new WriteRequest[0] : envelope.requests;
            foreach (WriteRequest request in requests)
            {
                try { Process(request); }
                catch (Exception error)
                {
                    Console.Error.WriteLine(DateTimeOffset.Now.ToString("o") + " " + request.id + " FAILED " + error.Message);
                    PostFailure(request, error.Message);
                }
            }
        }

        private static void Process(WriteRequest request)
        {
            if (request == null || request.payload == null || request.payload.client == null)
                throw new InvalidOperationException("Compass payload is incomplete.");
            if (!String.Equals(request.payload.operationType, "ensure_client", StringComparison.Ordinal) &&
                !String.Equals(request.payload.operationType, "ensure_client_and_job", StringComparison.Ordinal))
                throw new InvalidOperationException("Compass requested an unsupported Sage operation.");
            if (String.Equals(request.payload.operationType, "ensure_client_and_job", StringComparison.Ordinal) && request.payload.job == null)
                throw new InvalidOperationException("Compass client/job operation is missing the job payload.");
            if (!String.Equals(request.payload.company, TargetCompany, StringComparison.Ordinal))
                throw new InvalidOperationException("Compass payload targets the wrong Sage company.");
            ClientPayload client = request.payload.client;
            int clientStatus = ResolveCatalog("clnsts", "stsnme", client.status.name);
            if (clientStatus != client.status.expectedNumber)
                throw new InvalidOperationException("Client status mismatch: Compass expected " + client.status.expectedNumber + " " + client.status.name + ", but Sage resolved " + clientStatus + ".");
            SageRecord clientRecord = FindClient(client);
            if (clientRecord != null && clientRecord.StatusNumber != clientStatus)
                throw new InvalidOperationException("Matched Sage client has status " + clientRecord.StatusNumber + ", not requested status " + clientStatus + ".");

            int jobStatus = 0;
            int jobType = 0;
            SageRecord jobRecord = null;
            if (request.payload.job != null)
            {
                jobStatus = ResolveCatalog("jobsts", "stsnme", request.payload.job.statusName);
                jobType = ResolveCatalog("jobtyp", "typnme", request.payload.job.typeName);
                if (clientRecord != null) jobRecord = FindJob(request.payload.job, clientRecord.Number);
            }

            if (clientRecord == null || (request.payload.job != null && jobRecord == null))
            {
                string user = Required("SAGE_API_USER");
                string password = Required("SAGE_API_PASSWORD");
                using (new ApiSession(user, password))
                {
                    if (clientRecord == null)
                    {
                        string requestName = FindRequestName(new string[] { "ClientAddRq", "ClientAddNextRq" });
                        Submit(BuildClientXml(requestName, user, client, clientStatus), password);
                        clientRecord = FindClient(client);
                        if (clientRecord == null) throw new InvalidOperationException("Sage returned success but the client could not be read back.");
                    }
                    if (request.payload.job != null)
                    {
                        jobRecord = FindJob(request.payload.job, clientRecord.Number);
                        if (jobRecord == null)
                        {
                            string requestName = FindRequestName(new string[] { "JobAddWithCustomJobStatusRq", "JobAddNextWithCustomJobStatusRq", "JobAddRq", "JobAddNextRq" });
                            Submit(BuildJobXml(requestName, user, request.payload.job, clientRecord.Number, jobStatus, jobType), password);
                            jobRecord = FindJob(request.payload.job, clientRecord.Number);
                            if (jobRecord == null) throw new InvalidOperationException("Sage returned success but the job could not be read back.");
                        }
                    }
                }
            }
            if (jobRecord != null && (jobRecord.StatusNumber != jobStatus || jobRecord.TypeNumber != jobType))
                throw new InvalidOperationException("Matched Sage job status/type does not match the required Compass selections.");
            PostSuccess(request, clientRecord, jobRecord, clientStatus, jobStatus, jobType);
            Console.WriteLine(DateTimeOffset.Now.ToString("o") + " " + request.id + " SUCCEEDED client=" + clientRecord.Number + (jobRecord == null ? "" : " job=" + jobRecord.Number));
        }

        private static int ResolveCatalog(string table, string nameColumn, string name)
        {
            if (String.IsNullOrWhiteSpace(name)) throw new InvalidOperationException("A Sage catalog name is blank.");
            string sql = "SELECT recnum FROM dbo." + table + " WHERE LOWER(LTRIM(RTRIM(" + nameColumn + "))) = LOWER(LTRIM(RTRIM(@name)))";
            List<int> numbers = new List<int>();
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand(sql, connection))
            {
                command.Parameters.AddWithValue("@name", name);
                using (SqlDataReader reader = command.ExecuteReader()) while (reader.Read()) numbers.Add(Convert.ToInt32(reader[0]));
            }
            if (numbers.Count != 1) throw new InvalidOperationException("Sage " + table + " lookup for '" + name + "' returned " + numbers.Count + " rows.");
            return numbers[0];
        }

        private static SageRecord FindClient(ClientPayload client)
        {
            string predicate = String.IsNullOrWhiteSpace(client.email)
                ? "LOWER(LTRIM(RTRIM(clnnme))) = LOWER(LTRIM(RTRIM(@match)))"
                : "LOWER(LTRIM(RTRIM(e_mail))) = LOWER(LTRIM(RTRIM(@match)))";
            string match = String.IsNullOrWhiteSpace(client.email) ? client.name : client.email;
            return SingleRecord("SELECT CONVERT(varchar(36), _idnum), recnum, status, 0 FROM dbo.reccln WHERE " + predicate, match, null);
        }

        private static SageRecord FindJob(JobPayload job, int clientNumber)
        {
            return SingleRecord(
                "SELECT CONVERT(varchar(36), _idnum), recnum, status, jobtyp FROM dbo.actrec WHERE clnnum=@client AND LOWER(LTRIM(RTRIM(jobnme)))=LOWER(LTRIM(RTRIM(@match)))",
                job.name,
                clientNumber);
        }

        private static SageRecord SingleRecord(string sql, string match, int? clientNumber)
        {
            List<SageRecord> rows = new List<SageRecord>();
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand(sql, connection))
            {
                command.Parameters.AddWithValue("@match", match);
                if (clientNumber.HasValue) command.Parameters.AddWithValue("@client", clientNumber.Value);
                using (SqlDataReader reader = command.ExecuteReader())
                    while (reader.Read()) rows.Add(new SageRecord { Id = Convert.ToString(reader[0]), Number = Convert.ToInt32(reader[1]), StatusNumber = Convert.ToInt32(reader[2]), TypeNumber = Convert.ToInt32(reader[3]) });
            }
            if (rows.Count > 1) throw new InvalidOperationException("Duplicate Sage match is ambiguous; no write was attempted.");
            return rows.Count == 1 ? rows[0] : null;
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
                string actualDatabase = Convert.ToString(command.ExecuteScalar());
                if (!String.Equals(actualDatabase, TargetCompany, StringComparison.Ordinal))
                {
                    connection.Dispose();
                    throw new InvalidOperationException("SQL connection resolved to '" + actualDatabase + "', not the approved Sage company.");
                }
            }
            return connection;
        }

        private static string BuildClientXml(string requestName, string user, ClientPayload client, int statusNumber)
        {
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
                { "name", client.name }, { "clientname", client.name }, { "shortname", client.shortName },
                { "address1", client.address }, { "billingaddress1", client.billingAddress }, { "billaddress1", client.billingAddress },
                { "contact1", client.name }, { "email", client.email }, { "email1", client.email }, { "primaryemail", client.email },
                { "phone", client.phone }, { "phone1", client.phone }, { "notes", client.notes }, { "memo", client.notes }
            };
            Dictionary<string, int> references = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) {
                { "status", statusNumber }, { "statusref", statusNumber }, { "clientstatus", statusNumber }, { "clientstatusref", statusNumber }
            };
            return BuildXml(requestName, user, values, references);
        }

        private static string BuildJobXml(string requestName, string user, JobPayload job, int clientNumber, int statusNumber, int typeNumber)
        {
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
                { "name", job.name }, { "jobname", job.name }, { "shortname", job.shortName },
                { "address1", job.address }, { "contractnumber", job.compassProjectNumber }
            };
            Dictionary<string, int> references = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) {
                { "client", clientNumber }, { "clientref", clientNumber }, { "status", statusNumber }, { "statusref", statusNumber },
                { "jobstatus", statusNumber }, { "jobstatusref", statusNumber }, { "type", typeNumber }, { "typeref", typeNumber },
                { "jobtype", typeNumber }, { "jobtyperef", typeNumber }
            };
            return BuildXml(requestName, user, values, references);
        }

        private static string BuildXml(string requestName, string user, Dictionary<string, string> values, Dictionary<string, int> references)
        {
            List<XmlSchemaElement> fields = RequestFields(requestName);
            StringBuilder body = new StringBuilder();
            foreach (XmlSchemaElement field in fields)
            {
                string fieldName = String.IsNullOrWhiteSpace(field.Name) ? field.RefName.Name : field.Name;
                string key = Normalize(fieldName);
                string value;
                int reference;
                if (values.TryGetValue(key, out value) && !String.IsNullOrWhiteSpace(value))
                    body.Append("<").Append(fieldName).Append(">").Append(XmlEscape(Truncate(value, MaxLength(field)))).Append("</").Append(fieldName).Append(">");
                else if (references.TryGetValue(key, out reference))
                {
                    if (field.ElementSchemaType is XmlSchemaComplexType)
                        body.Append("<").Append(fieldName).Append("><ObjectID>").Append(reference).Append("</ObjectID></").Append(fieldName).Append(">");
                    else
                        body.Append("<").Append(fieldName).Append(">").Append(reference).Append("</").Append(fieldName).Append(">");
                }
                else if (field.MinOccurs > 0)
                    throw new InvalidOperationException(requestName + " requires unmapped Sage field " + fieldName + "; no write was attempted.");
            }
            string xml = "<api:MBXML xmlns:api=\"http://sage100contractor.com/api\"><MBXMLSessionRq><Company>" + XmlEscape(TargetCompany) + "</Company><User>" + XmlEscape(user) + "</User></MBXMLSessionRq><MBXMLMsgsRq messageSetID=\"compass-client-project\" onError=\"stopOnError\"><" + requestName + " requestID=\"" + Guid.NewGuid().ToString() + "\">" + body + "</" + requestName + "></MBXMLMsgsRq></api:MBXML>";
            ValidateXml(xml);
            return xml;
        }

        private static string FindRequestName(string[] candidates)
        {
            foreach (string candidate in candidates)
                try { if (RequestFields(candidate).Count > 0) return candidate; } catch { }
            throw new InvalidOperationException("Installed mbxml.xsd does not contain an approved client/job add request.");
        }

        private static List<XmlSchemaElement> RequestFields(string requestName)
        {
            XmlSchemaSet set = LoadSchemas();
            foreach (XmlSchema schema in set.Schemas())
                foreach (XmlSchemaObject item in schema.Items)
                {
                    XmlSchemaComplexType type = item as XmlSchemaComplexType;
                    if (type == null) continue;
                    XmlSchemaElement request = FindElement(type.Particle, requestName);
                    if (request == null) continue;
                    XmlSchemaComplexType requestType = request.ElementSchemaType as XmlSchemaComplexType;
                    if (requestType == null) continue;
                    List<XmlSchemaElement> fields = new List<XmlSchemaElement>();
                    CollectElements(requestType.Particle, fields);
                    return fields;
                }
            throw new InvalidOperationException("Request " + requestName + " is absent from installed mbxml.xsd.");
        }

        private static XmlSchemaSet LoadSchemas()
        {
            XmlSchemaSet set = new XmlSchemaSet();
            set.Add("http://sage100contractor.com/api", XsdPath);
            set.Compile(); return set;
        }
        private static XmlSchemaElement FindElement(XmlSchemaParticle particle, string name)
        {
            XmlSchemaGroupBase group = particle as XmlSchemaGroupBase;
            if (group == null) return null;
            foreach (XmlSchemaObject item in group.Items)
            {
                XmlSchemaElement element = item as XmlSchemaElement;
                if (element != null && String.Equals(element.Name, name, StringComparison.Ordinal)) return element;
                XmlSchemaElement nested = FindElement(item as XmlSchemaParticle, name);
                if (nested != null) return nested;
            }
            return null;
        }
        private static void CollectElements(XmlSchemaParticle particle, List<XmlSchemaElement> result)
        {
            XmlSchemaGroupBase group = particle as XmlSchemaGroupBase;
            if (group == null) return;
            foreach (XmlSchemaObject item in group.Items)
            {
                XmlSchemaElement element = item as XmlSchemaElement;
                if (element != null) result.Add(element);
            }
        }
        private static int MaxLength(XmlSchemaElement field)
        {
            XmlSchemaSimpleType simple = field.ElementSchemaType as XmlSchemaSimpleType;
            XmlSchemaSimpleTypeRestriction restriction = simple == null ? null : simple.Content as XmlSchemaSimpleTypeRestriction;
            if (restriction != null) foreach (XmlSchemaFacet facet in restriction.Facets)
            {
                XmlSchemaMaxLengthFacet maximum = facet as XmlSchemaMaxLengthFacet;
                int parsed; if (maximum != null && Int32.TryParse(maximum.Value, out parsed)) return parsed;
            }
            return 4000;
        }
        private static void ValidateXml(string xml)
        {
            StringBuilder errors = new StringBuilder();
            XmlReaderSettings settings = new XmlReaderSettings { Schemas = LoadSchemas(), ValidationType = ValidationType.Schema };
            settings.ValidationEventHandler += delegate(object sender, ValidationEventArgs args) { errors.AppendLine(args.Message); };
            using (StringReader input = new StringReader(xml))
            using (XmlReader reader = XmlReader.Create(input, settings)) while (reader.Read()) { }
            if (errors.Length > 0) throw new InvalidOperationException("Sage XML validation failed before write: " + errors.ToString().Trim());
        }

        private static void Submit(string xml, string password)
        {
            object response = Invoke("submitXML", new object[] { xml, password });
            string text = Convert.ToString(response);
            if (text.IndexOf("statusCode=\"0\"", StringComparison.OrdinalIgnoreCase) < 0)
                throw new InvalidOperationException("Sage API rejected the add request: " + Truncate(text.Replace("\r", " ").Replace("\n", " "), 1000));
        }

        private static void PostSuccess(WriteRequest request, SageRecord client, SageRecord job, int clientStatus, int jobStatus, int jobType)
        {
            Dictionary<string, object> result = BaseResult(request, "succeeded");
            result["client"] = new Dictionary<string, object> { { "id", client.Id }, { "number", client.Number.ToString() }, { "statusNumber", clientStatus } };
            result["job"] = job == null ? null : (object)new Dictionary<string, object> { { "id", job.Id }, { "number", job.Number.ToString() }, { "statusNumber", jobStatus }, { "typeNumber", jobType } };
            Send("POST", ResultsTarget, Json.Serialize(result));
        }
        private static void PostFailure(WriteRequest request, string error)
        {
            Dictionary<string, object> result = BaseResult(request, "failed");
            result["error"] = Truncate(error, 4000);
            Send("POST", ResultsTarget, Json.Serialize(result));
        }
        private static Dictionary<string, object> BaseResult(WriteRequest request, string outcome)
        {
            return new Dictionary<string, object> { { "operationId", request.id }, { "claimToken", request.claimToken }, { "outcome", outcome } };
        }

        private static string Send(string method, string target, string body)
        {
            string baseUrl = Required("COMPASS_BASE_URL").TrimEnd('/');
            string timestamp = Convert.ToInt64(
                (DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds
            ).ToString();
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
                throw new InvalidOperationException("Compass bridge request failed: " + details, error);
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

        private static object Invoke(string name, object[] args) { return FindMethod(ImbxmlType, name, args.Length, false).Invoke(ApiInstance, args); }
        private static object InvokeStatic(string name, object[] args) { return FindMethod(GlobalType, name, args.Length, true).Invoke(null, args); }
        private static MethodInfo FindMethod(Type type, string name, int count, bool isStatic)
        {
            BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | (isStatic ? BindingFlags.Static : BindingFlags.Instance);
            foreach (MethodInfo method in type.GetMethods(flags)) if (String.Equals(method.Name, name, StringComparison.OrdinalIgnoreCase) && method.GetParameters().Length == count) return method;
            throw new MissingMethodException(type.FullName, name);
        }
        private static string Required(string name)
        {
            string value = Environment.GetEnvironmentVariable(name);
            if (String.IsNullOrWhiteSpace(value)) throw new InvalidOperationException(name + " is required."); return value.Trim();
        }
        private static string DataSource() { return Environment.GetEnvironmentVariable("SAGE_SQL_SERVER") ?? @"NUC-PC\SQLEXPRESS"; }
        private static string Normalize(string value) { return (value ?? "").Replace("_", "").Replace("-", "").ToLowerInvariant(); }
        private static string Truncate(string value, int length) { if (String.IsNullOrEmpty(value)) return value; return value.Length <= length ? value : value.Substring(0, length); }
        private static string XmlEscape(string value) { return SecurityElement.Escape(value ?? "") ?? ""; }
    }
}
