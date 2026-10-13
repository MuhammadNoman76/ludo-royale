using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace LudoRoyale.Services
{
    /// <summary>
    /// JSON with the serializer built into .NET Framework (no extra DLLs to ship). Incoming messages
    /// are read as plain dictionaries and every field is checked by type.
    /// </summary>
    internal static class Json
    {
        private static JavaScriptSerializer NewSerializer() => new JavaScriptSerializer { MaxJsonLength = 1 << 20, RecursionLimit = 16 };

        public static string Serialize(object? value) => NewSerializer().Serialize(value);

        /// <summary>A JSON object, or null if the text isn't one.</summary>
        public static Dictionary<string, object?>? ParseObject(string? json, int maxLength = 64 * 1024)
        {
            if (string.IsNullOrEmpty(json) || json!.Length > maxLength) return null;
            try
            {
                return NewSerializer().DeserializeObject(json) as Dictionary<string, object?>;
            }
            catch (Exception)
            {
                return null;
            }
        }

        public static string? Str(this Dictionary<string, object?> o, string key, int maxLength = 512)
        {
            return o.TryGetValue(key, out var v) && v is string s && s.Length <= maxLength ? s : null;
        }

        public static bool? Bool(this Dictionary<string, object?> o, string key)
        {
            return o.TryGetValue(key, out var v) && v is bool b ? b : (bool?)null;
        }

        public static double? Num(this Dictionary<string, object?> o, string key)
        {
            if (!o.TryGetValue(key, out var v) || v == null) return null;
            switch (v)
            {
                case int i: return i;
                case long l: return l;
                case decimal m: return (double)m;
                case double d: return d;
                default: return null;
            }
        }

        public static Dictionary<string, object?>? Obj(this Dictionary<string, object?> o, string key)
        {
            return o.TryGetValue(key, out var v) ? v as Dictionary<string, object?> : null;
        }

        public static List<string> StrList(this Dictionary<string, object?> o, string key)
        {
            var list = new List<string>();
            if (o.TryGetValue(key, out var v) && v is object[] items)
            {
                foreach (var item in items)
                    if (item is string s) list.Add(s);
            }
            return list;
        }
    }
}
