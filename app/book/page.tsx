import Link from "next/link";

export default function BookLanding() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#888" }}>Court 16 · Book</div>
      <h1 style={{ fontSize: 28, margin: "4px 0 32px" }}>Who are you booking for?</h1>

      <div style={{ display: "grid", gap: 12 }}>
        <Link href="/book/kid" style={card}>
          <div style={cardLabel}>My child</div>
          <div style={cardSub}>Free trial, staff-confirmed</div>
        </Link>
        <Link href="/book/adult" style={{ ...card, opacity: 0.6, pointerEvents: "none" }}>
          <div style={cardLabel}>Me (adult)</div>
          <div style={cardSub}>Tennis / pickleball intro — Track 1 coming soon</div>
        </Link>
      </div>

      <p style={{ marginTop: 32, fontSize: 12, color: "#888" }}>
        Already a member? Book drop-ins through the MindBody app.
      </p>
    </main>
  );
}

const card: React.CSSProperties = {
  display: "block",
  padding: "20px 24px",
  border: "1px solid #e5e5e5",
  borderRadius: 12,
  color: "#111",
  textDecoration: "none",
  background: "#fff",
};
const cardLabel: React.CSSProperties = { fontSize: 18, fontWeight: 600, marginBottom: 4 };
const cardSub: React.CSSProperties = { fontSize: 13, color: "#666" };
