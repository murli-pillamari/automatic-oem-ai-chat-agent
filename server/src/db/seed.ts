import { db } from "./database.js";

const sessionId = "demo-ria-sharma";
if (!db.getSession(sessionId)) {
  db.createSession(sessionId, { name: "Ria Sharma", phone: "+919876543210" });
  db.updateSession(sessionId, { stage: "sales" });
  db.saveMessage(sessionId, "user", "I am interested in the EV X1.");
  db.saveMessage(sessionId, "model", "Great choice. I can help with an EV X1 test drive, quote, or ownership questions.");
}
console.log(`Seeded local test record: ${sessionId}`);
