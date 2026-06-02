// Транспилирует dist/admin.js под старые браузеры (iOS 12+, старый Android):
// исходник public/admin.js остаётся читаемым, в прод едет совместимый код.
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "..", "dist", "admin.js");
if (!fs.existsSync(FILE)) { console.error("transpile-admin: dist/admin.js не найден"); process.exit(1); }
const src = fs.readFileSync(FILE, "utf8");
const before = (src.match(/\?\./g) || []).length;
const out = babel.transform(src, {
  sourceType: "script",
  presets: [["@babel/preset-env", { targets: { ios: "12", safari: "12", chrome: "61", samsung: "8", android: "5" }, bugfixes: true }]],
  compact: false, comments: false,
}).code;
fs.writeFileSync(FILE, out);
console.log("transpile-admin: ✓ " + before + " optional-chaining → 0; dist/admin.js совместим со старыми браузерами");
