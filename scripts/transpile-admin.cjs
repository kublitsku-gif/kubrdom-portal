// Транспилирует инлайн-скрипт dist/admin.html под старые браузеры (iOS 12+, старый Android):
// исходник public/admin.html остаётся читаемым, в прод едет совместимый код.
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "..", "dist", "admin.html");
const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error("transpile-admin: <script> не найден"); process.exit(1); }
const before = (m[1].match(/\?\./g) || []).length;
const out = babel.transform(m[1], {
  sourceType: "script",
  presets: [["@babel/preset-env", { targets: { ios: "12", safari: "12", chrome: "61", samsung: "8", android: "5" }, bugfixes: true }]],
  compact: false, comments: false,
}).code;
fs.writeFileSync(FILE, html.replace(/<script>[\s\S]*<\/script>/, "<script>\n" + out + "\n</script>"));
console.log("transpile-admin: ✓ " + before + " optional-chaining → 0; dist/admin.html совместим со старыми браузерами");
