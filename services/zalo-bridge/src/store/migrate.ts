import { migrateDb, sql } from "./db.js";

await migrateDb();
await sql.end();
console.log("Đã chạy migration.");
