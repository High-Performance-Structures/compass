using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;

// Hand-run cost code description renames, part of the approved Compass Sage
// writer (Sage's API approval belongs to that one installed program). Never
// queued from Compass; staff run it with a reviewed list kept outside this repo:
//
//   CompassSageClientProjectWriter.exe --rename-cost-codes --input <file.json> [--apply] [--out <dir>]
//
// The file is a JSON array of { recnum, current, proposed }. Without --apply it
// is a dry run: each row is read from Sage and reported as "rename" (Sage still
// shows `current`), "already_renamed" (Sage already shows `proposed`),
// "skipped_changed" (someone changed it in Sage since the review) or "error"
// (unknown or out-of-scope number, bad text). Nothing is written.
//
// --apply refuses unless every row is "rename" or "already_renamed". It saves
// a backup of the rows first, then sends every rename as one Sage API message
// set of CostCodeModRq requests that carry only the description (Desc), the way
// every other writer edit goes through Sage rather than SQL. Sage commits when
// the API session closes, so every row is read back afterwards; if any row
// doesn't read as proposed, the rows that did change are renamed back to their
// old descriptions in a child run (a second API session in one process fails).
//
// Scope: sequence numbers 1-43, company codes 500-514 and 900000000+ range
// project codes are refused. Descriptions are at most 50 characters (the
// schema's String50; Sage's cstcde.cdenme).
namespace CompassSageClientProjectWriter
{
    internal static partial class Program
    {
        private const int CostCodeDescriptionMax = 50;

        public sealed class CostCodeRenameItem
        {
            public long recnum { get; set; }
            public string current { get; set; }
            public string proposed { get; set; }
        }

        private sealed class CostCodeRenamePlanRow
        {
            public CostCodeRenameItem Item;
            public string InSage;
            public string Status;
            public string Detail;
        }

        private static JavaScriptSerializer CostCodeJson()
        {
            return new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };
        }

        /// <summary>Why a recnum is outside the rename scope, or null when it's in scope.</summary>
        private static string CostCodeRenameExcluded(long recnum)
        {
            if (recnum < 1) return "not a Sage cost code number";
            if (recnum <= 43) return "sequence numbers 1-43 are out of scope";
            if (recnum >= 500 && recnum <= 514) return "company codes 500-514 are out of scope";
            if (recnum >= 900000000) return "range project codes 900000000+ are out of scope";
            return null;
        }

        /// <summary>What's wrong with one list row on its own, or null when it's usable.</summary>
        private static string CostCodeRenameItemError(CostCodeRenameItem item)
        {
            if (item == null) return "empty row";
            string excluded = CostCodeRenameExcluded(item.recnum);
            if (excluded != null) return excluded;
            if (item.current == null) return "current description is missing";
            if (String.IsNullOrWhiteSpace(item.proposed)) return "proposed description is blank";
            if (!String.Equals(item.proposed, item.proposed.Trim(), StringComparison.Ordinal)) return "proposed description has leading or trailing spaces";
            if (item.proposed.Length > CostCodeDescriptionMax) return "proposed description is " + item.proposed.Length + " characters; Sage allows " + CostCodeDescriptionMax;
            foreach (char c in item.proposed) if (Char.IsControl(c)) return "proposed description has a control character";
            if (String.Equals(item.proposed, item.current, StringComparison.Ordinal)) return "proposed description is the same as the current one";
            return null;
        }

        /// <summary>One row against what Sage shows now (null = no such cost code): rename, already_renamed, skipped_changed or error.</summary>
        private static string CostCodeRenameStatus(CostCodeRenameItem item, string inSage, out string detail)
        {
            detail = CostCodeRenameItemError(item);
            if (detail != null) return "error";
            if (inSage == null) { detail = "Sage has no cost code " + item.recnum; return "error"; }
            if (String.Equals(inSage, item.proposed, StringComparison.Ordinal)) { detail = "Sage already shows the proposed description"; return "already_renamed"; }
            if (String.Equals(inSage, item.current, StringComparison.Ordinal)) { detail = "would rename"; return "rename"; }
            detail = "skipped: changed in Sage since review (Sage shows '" + inSage + "')";
            return "skipped_changed";
        }

        /// <summary>Plans every row: each must pass on its own, and a number may appear only once.</summary>
        private static List<CostCodeRenamePlanRow> PlanCostCodeRenames(CostCodeRenameItem[] items, IDictionary<long, string> sage)
        {
            List<CostCodeRenamePlanRow> plan = new List<CostCodeRenamePlanRow>();
            HashSet<long> seen = new HashSet<long>();
            foreach (CostCodeRenameItem item in items)
            {
                string inSage = null;
                if (item != null) sage.TryGetValue(item.recnum, out inSage);
                string detail;
                string status = CostCodeRenameStatus(item, inSage, out detail);
                if (item != null && !seen.Add(item.recnum)) { status = "error"; detail = "cost code " + item.recnum + " is listed more than once"; }
                plan.Add(new CostCodeRenamePlanRow { Item = item, InSage = inSage, Status = status, Detail = detail });
            }
            return plan;
        }

        private static int RunCostCodeRename(string[] args)
        {
            string input = null, outDir = null;
            bool apply = false, noRevert = false;
            for (int index = 1; index < args.Length; index++)
            {
                if (String.Equals(args[index], "--input", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length) input = args[++index];
                else if (String.Equals(args[index], "--out", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length) outDir = args[++index];
                else if (String.Equals(args[index], "--apply", StringComparison.OrdinalIgnoreCase)) apply = true;
                else if (String.Equals(args[index], "--no-revert", StringComparison.OrdinalIgnoreCase)) noRevert = true;
                else { Console.Error.WriteLine("Unknown argument " + args[index] + ". Usage: --rename-cost-codes --input <file.json> [--apply] [--out <dir>]"); return 2; }
            }
            if (String.IsNullOrWhiteSpace(input)) { Console.Error.WriteLine("Usage: --rename-cost-codes --input <file.json> [--apply] [--out <dir>]"); return 2; }
            string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
            outDir = String.IsNullOrWhiteSpace(outDir) ? Path.GetDirectoryName(Path.GetFullPath(input)) : outDir;
            string resultPath = Path.Combine(outDir, "cost-code-rename-" + (apply ? "apply" : "dryrun") + "-" + stamp + ".json");
            Dictionary<string, object> result = new Dictionary<string, object> {
                { "mode", apply ? "apply" : "dry_run" }, { "input", Path.GetFullPath(input) }, { "startedAt", DateTimeOffset.Now.ToString("o") } };
            try
            {
                RequireConfiguration(false);
                CostCodeRenameItem[] items = CostCodeJson().Deserialize<CostCodeRenameItem[]>(File.ReadAllText(input, Encoding.UTF8));
                if (items == null || items.Length == 0) throw new InvalidOperationException("The rename list is empty; nothing was changed.");
                List<CostCodeRenamePlanRow> plan = PlanCostCodeRenames(items, ReadCostCodeDescriptions());
                List<CostCodeRenamePlanRow> renames = plan.FindAll(row => row.Status == "rename");
                Dictionary<string, int> counts = CostCodeRenameCounts(plan);
                result["counts"] = counts;
                result["rows"] = plan.ConvertAll(CostCodeRowResult);
                // Build and schema-check the exact request in both modes, so a dry run proves it.
                string user = Required("SAGE_API_USER");
                string xml = renames.Count == 0 ? null : BuildCostCodeRenameXml(user, renames);
                if (!apply)
                {
                    result["outcome"] = "dry_run";
                    return FinishCostCodeRename(result, resultPath, 0);
                }
                if (counts["error"] > 0 || counts["skipped_changed"] > 0)
                {
                    result["outcome"] = "refused";
                    result["error"] = "Every row must be 'rename' or 'already_renamed' before --apply; nothing was changed. Review the error/skipped rows and remove or fix them.";
                    return FinishCostCodeRename(result, resultPath, 1);
                }
                if (renames.Count == 0)
                {
                    result["outcome"] = "nothing_to_do";
                    return FinishCostCodeRename(result, resultPath, 0);
                }

                List<long> numbers = renames.ConvertAll(row => row.Item.recnum);
                Dictionary<long, Dictionary<string, string>> before = ReadCostCodeRows(numbers);
                string backupPath = Path.Combine(outDir, "cost-code-rename-backup-" + stamp + ".json");
                WriteCostCodeJson(backupPath, new Dictionary<string, object> {
                    { "takenAt", DateTimeOffset.Now.ToString("o") }, { "rows", CostCodeRowsJson(before) },
                    { "revert", renames.ConvertAll(row => new CostCodeRenameItem { recnum = row.Item.recnum, current = row.Item.proposed, proposed = row.Item.current }) } });
                result["backup"] = backupPath;
                WriteLog("INFO", "COST_CODE_RENAME_START rows=" + renames.Count + " backup=" + backupPath);

                string password = Required("SAGE_API_PASSWORD");
                Exception submitError = null;
                try
                {
                    using (new ApiSession(user, password))
                        RunStage("submit Sage cost code renames", delegate { Submit(xml, password); });
                }
                catch (Exception error) { submitError = error; }

                // Sage commits when the session closes, so read back after it.
                Dictionary<long, string> now = ReadCostCodeDescriptions();
                Dictionary<long, Dictionary<string, string>> after = ReadCostCodeRows(numbers);
                List<long> renamed = new List<long>();
                List<string> wrong = new List<string>();
                foreach (CostCodeRenamePlanRow row in renames)
                {
                    string value;
                    now.TryGetValue(row.Item.recnum, out value);
                    if (String.Equals(value, row.Item.proposed, StringComparison.Ordinal)) renamed.Add(row.Item.recnum);
                    else wrong.Add(row.Item.recnum + " reads '" + value + "'");
                }
                result["renamed"] = renamed.Count;
                result["otherColumnsChanged"] = CostCodeOtherChanges(before, after);
                if (submitError == null && wrong.Count == 0)
                {
                    result["outcome"] = "applied";
                    WriteLog("INFO", "COST_CODE_RENAME_OK rows=" + renamed.Count);
                    return FinishCostCodeRename(result, resultPath, 0);
                }

                result["error"] = (submitError == null ? "" : submitError.Message + " ") + (wrong.Count == 0 ? "" : "Not renamed: " + String.Join("; ", wrong.ToArray()));
                if (renamed.Count == 0) { result["outcome"] = "failed_nothing_changed"; return FinishCostCodeRename(result, resultPath, 1); }
                if (noRevert) { result["outcome"] = "failed_partial_not_reverted"; return FinishCostCodeRename(result, resultPath, 1); }
                result["outcome"] = RevertCostCodeRenames(renames, renamed, outDir, stamp, result) ? "rolled_back" : "rollback_failed";
                return FinishCostCodeRename(result, resultPath, 1);
            }
            catch (Exception error)
            {
                result["outcome"] = result.ContainsKey("backup") ? "failed_check_sage" : "failed_nothing_changed";
                result["error"] = error.Message;
                WriteLog("FATAL", "COST_CODE_RENAME_FAILED " + error.ToString());
                return FinishCostCodeRename(result, resultPath, 1);
            }
        }

        /// <summary>Renames the rows that changed back to their old descriptions in a child run, then checks them.</summary>
        private static bool RevertCostCodeRenames(List<CostCodeRenamePlanRow> renames, List<long> renamed, string outDir, string stamp, Dictionary<string, object> result)
        {
            List<CostCodeRenameItem> revert = new List<CostCodeRenameItem>();
            foreach (CostCodeRenamePlanRow row in renames)
                if (renamed.Contains(row.Item.recnum))
                    revert.Add(new CostCodeRenameItem { recnum = row.Item.recnum, current = row.Item.proposed, proposed = row.Item.current });
            string revertPath = Path.Combine(outDir, "cost-code-rename-revert-" + stamp + ".json");
            WriteCostCodeJson(revertPath, revert);
            result["revertInput"] = revertPath;
            WriteLog("ERROR", "COST_CODE_RENAME_REVERTING rows=" + revert.Count + " file=" + revertPath);
            System.Diagnostics.ProcessStartInfo start = new System.Diagnostics.ProcessStartInfo(Assembly.GetExecutingAssembly().Location,
                "--rename-cost-codes --input \"" + revertPath + "\" --apply --no-revert --out \"" + outDir + "\"") { UseShellExecute = false, CreateNoWindow = true };
            using (System.Diagnostics.Process child = System.Diagnostics.Process.Start(start))
            {
                if (child == null || !child.WaitForExit(10 * 60 * 1000)) return false;
            }
            Dictionary<long, string> now = ReadCostCodeDescriptions();
            foreach (CostCodeRenameItem item in revert)
            {
                string value;
                if (!now.TryGetValue(item.recnum, out value) || !String.Equals(value, item.proposed, StringComparison.Ordinal)) return false;
            }
            return true;
        }

        private static string BuildCostCodeRenameXml(string user, List<CostCodeRenamePlanRow> renames)
        {
            // Only ObjectRef and Desc: every other CostCodeModRq field is optional and left out, so Sage keeps it.
            StringBuilder body = new StringBuilder();
            foreach (CostCodeRenamePlanRow row in renames)
                body.Append("<CostCodeModRq requestID=\"").Append(Guid.NewGuid().ToString()).Append("\"><ObjectRef><ObjectID>")
                    .Append(row.Item.recnum.ToString(CultureInfo.InvariantCulture)).Append("</ObjectID></ObjectRef><Desc>")
                    .Append(XmlEscape(row.Item.proposed)).Append("</Desc></CostCodeModRq>");
            string xml = "<api:MBXML xmlns:api=\"http://sage100contractor.com/api\"><MBXMLSessionRq><Company>" + XmlEscape(TargetCompany) + "</Company><User>" + XmlEscape(user) +
                "</User></MBXMLSessionRq><MBXMLMsgsRq messageSetID=\"compass-cost-code-rename\" onError=\"stopOnError\">" + body + "</MBXMLMsgsRq></api:MBXML>";
            ValidateXml(xml);
            return xml;
        }

        /// <summary>Every cost code's description, read-only; trailing pad spaces trimmed.</summary>
        private static Dictionary<long, string> ReadCostCodeDescriptions()
        {
            Dictionary<long, string> rows = new Dictionary<long, string>();
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand("SELECT recnum, cdenme FROM dbo.cstcde", connection))
            using (SqlDataReader reader = command.ExecuteReader())
                while (reader.Read())
                {
                    long number = CostCodeNumber(reader[0]);
                    if (rows.ContainsKey(number)) throw new InvalidOperationException("Sage has more than one cost code " + number + "; nothing was changed.");
                    rows[number] = reader.IsDBNull(1) ? "" : Convert.ToString(reader[1]).TrimEnd();
                }
            return rows;
        }

        /// <summary>Every column of the named cost codes, as text, for the backup and the after check.</summary>
        private static Dictionary<long, Dictionary<string, string>> ReadCostCodeRows(List<long> numbers)
        {
            HashSet<long> wanted = new HashSet<long>(numbers);
            Dictionary<long, Dictionary<string, string>> rows = new Dictionary<long, Dictionary<string, string>>();
            using (SqlConnection connection = OpenSql())
            using (SqlCommand command = new SqlCommand("SELECT * FROM dbo.cstcde", connection))
            using (SqlDataReader reader = command.ExecuteReader())
                while (reader.Read())
                {
                    long number = CostCodeNumber(reader["recnum"]);
                    if (!wanted.Contains(number)) continue;
                    Dictionary<string, string> row = new Dictionary<string, string>();
                    for (int column = 0; column < reader.FieldCount; column++)
                    {
                        object value = reader.GetValue(column);
                        byte[] bytes = value as byte[];
                        row[reader.GetName(column)] = value is DBNull ? null : bytes != null ? Convert.ToBase64String(bytes) : Convert.ToString(value, CultureInfo.InvariantCulture);
                    }
                    rows[number] = row;
                }
            return rows;
        }

        /// <summary>Columns other than the description that differ after the write (Sage's own audit columns are expected here).</summary>
        private static Dictionary<string, object> CostCodeOtherChanges(Dictionary<long, Dictionary<string, string>> before, Dictionary<long, Dictionary<string, string>> after)
        {
            Dictionary<string, object> changes = new Dictionary<string, object>();
            foreach (KeyValuePair<long, Dictionary<string, string>> row in before)
            {
                Dictionary<string, string> later;
                if (!after.TryGetValue(row.Key, out later)) { changes[row.Key.ToString(CultureInfo.InvariantCulture)] = new string[] { "(row missing)" }; continue; }
                List<string> columns = new List<string>();
                foreach (KeyValuePair<string, string> column in row.Value)
                {
                    if (String.Equals(column.Key, "cdenme", StringComparison.OrdinalIgnoreCase)) continue;
                    string value;
                    later.TryGetValue(column.Key, out value);
                    if (!String.Equals(value, column.Value, StringComparison.Ordinal)) columns.Add(column.Key);
                }
                if (columns.Count > 0) changes[row.Key.ToString(CultureInfo.InvariantCulture)] = columns.ToArray();
            }
            return changes;
        }

        private static long CostCodeNumber(object value)
        {
            decimal number = Convert.ToDecimal(value, CultureInfo.InvariantCulture);
            if (number != Decimal.Truncate(number)) throw new InvalidOperationException("Sage cost code number " + number + " is not whole; nothing was changed.");
            return (long)number;
        }

        private static Dictionary<string, int> CostCodeRenameCounts(List<CostCodeRenamePlanRow> plan)
        {
            Dictionary<string, int> counts = new Dictionary<string, int> { { "rename", 0 }, { "already_renamed", 0 }, { "skipped_changed", 0 }, { "error", 0 } };
            foreach (CostCodeRenamePlanRow row in plan) counts[row.Status]++;
            counts["total"] = plan.Count;
            return counts;
        }

        private static Dictionary<string, object> CostCodeRowResult(CostCodeRenamePlanRow row)
        {
            return new Dictionary<string, object> {
                { "recnum", row.Item == null ? 0 : row.Item.recnum }, { "status", row.Status }, { "detail", row.Detail },
                { "current", row.Item == null ? null : row.Item.current }, { "proposed", row.Item == null ? null : row.Item.proposed }, { "inSage", row.InSage } };
        }

        private static Dictionary<string, object> CostCodeRowsJson(Dictionary<long, Dictionary<string, string>> rows)
        {
            Dictionary<string, object> json = new Dictionary<string, object>();
            foreach (KeyValuePair<long, Dictionary<string, string>> row in rows) json[row.Key.ToString(CultureInfo.InvariantCulture)] = row.Value;
            return json;
        }

        private static void WriteCostCodeJson(string path, object value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
            File.WriteAllText(path, CostCodeJson().Serialize(value), new UTF8Encoding(false));
        }

        private static int FinishCostCodeRename(Dictionary<string, object> result, string resultPath, int exitCode)
        {
            result["finishedAt"] = DateTimeOffset.Now.ToString("o");
            try { WriteCostCodeJson(resultPath, result); }
            catch (Exception error) { Console.Error.WriteLine("Could not write the result file " + resultPath + ": " + error.Message); exitCode = 1; }
            object counts;
            result.TryGetValue("counts", out counts);
            Dictionary<string, int> summary = counts as Dictionary<string, int>;
            string line = "COST_CODE_RENAME " + Convert.ToString(result["mode"]) + " outcome=" + Convert.ToString(result["outcome"]) +
                (summary == null ? "" : " total=" + summary["total"] + " rename=" + summary["rename"] + " already_renamed=" + summary["already_renamed"] +
                    " skipped_changed=" + summary["skipped_changed"] + " error=" + summary["error"]) +
                (result.ContainsKey("renamed") ? " renamed=" + result["renamed"] : "") + " result=" + resultPath;
            WriteLog(exitCode == 0 ? "INFO" : "ERROR", line);
            if (result.ContainsKey("error")) Console.Error.WriteLine("Error: " + result["error"]);
            return exitCode;
        }

        /// <summary>Checks the pure rename rules without Sage: --rename-cost-codes-selftest.</summary>
        private static int RunCostCodeRenameSelfTest()
        {
            List<string> failures = new List<string>();
            Action<bool, string> check = delegate(bool ok, string name) { if (!ok) failures.Add(name); };
            foreach (long excluded in new long[] { 0, 1, 43, 500, 514, 900000000, 900000123 })
                check(CostCodeRenameExcluded(excluded) != null, "excluded " + excluded);
            foreach (long allowed in new long[] { 44, 499, 515, 1000000, 3350109, 899999999 })
                check(CostCodeRenameExcluded(allowed) == null, "allowed " + allowed);
            CostCodeRenameItem good = new CostCodeRenameItem { recnum = 3350109, current = "03 35 33 - Stamped Concrete Finishing", proposed = "03 35 01.09 - Stamped Concrete Finishing" };
            check(CostCodeRenameItemError(good) == null, "good row");
            check(CostCodeRenameItemError(new CostCodeRenameItem { recnum = 3350109, current = "a", proposed = new string('x', 51) }) != null, "51 chars refused");
            check(CostCodeRenameItemError(new CostCodeRenameItem { recnum = 3350109, current = "a", proposed = new string('x', 50) }) == null, "50 chars allowed");
            check(CostCodeRenameItemError(new CostCodeRenameItem { recnum = 3350109, current = "a", proposed = " x" }) != null, "leading space refused");
            check(CostCodeRenameItemError(new CostCodeRenameItem { recnum = 3350109, current = "a", proposed = "a" }) != null, "no-op refused");
            check(CostCodeRenameItemError(new CostCodeRenameItem { recnum = 3350109, current = null, proposed = "a" }) != null, "missing current refused");
            check(CostCodeRenameItemError(new CostCodeRenameItem { recnum = 510, current = "a", proposed = "b" }) != null, "company code refused");
            string detail;
            check(CostCodeRenameStatus(good, good.current, out detail) == "rename", "rename");
            check(CostCodeRenameStatus(good, good.proposed, out detail) == "already_renamed", "already renamed");
            check(CostCodeRenameStatus(good, "Someone else's name", out detail) == "skipped_changed", "changed since review");
            check(CostCodeRenameStatus(good, null, out detail) == "error", "unknown recnum");
            Dictionary<long, string> sage = new Dictionary<long, string> { { 3350109, good.current } };
            List<CostCodeRenamePlanRow> plan = PlanCostCodeRenames(new CostCodeRenameItem[] { good, good }, sage);
            check(plan[0].Status == "rename" && plan[1].Status == "error", "duplicate recnum");
            foreach (string failure in failures) Console.Error.WriteLine("FAIL " + failure);
            Console.WriteLine(failures.Count == 0 ? "COST_CODE_RENAME_SELFTEST_OK" : "COST_CODE_RENAME_SELFTEST_FAILED " + failures.Count);
            return failures.Count == 0 ? 0 : 1;
        }
    }
}
