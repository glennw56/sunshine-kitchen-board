import { randomBytes, scryptSync } from "crypto";
import fs from "fs";
import path from "path";

const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(dir, { recursive: true });
const email = (process.env.ADMIN_EMAIL || "glenn.will799@gmail.com").trim().toLowerCase();
const password = process.argv[2] || randomBytes(12).toString("base64url");
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
fs.writeFileSync(path.join(dir, "admin.json"), JSON.stringify({ email, salt, hash }, null, 2));
const note = `email: ${email}\npassword: ${password}\n`;
fs.writeFileSync(path.join(dir, "owner-password.txt"), note, { mode: 0o600 });
process.stdout.write(`Owner login reset.\nemail: ${email}\npassword: ${password}\nStored hash in ${dir}/admin.json\n`);
