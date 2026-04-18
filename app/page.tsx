import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#888" }}>Court 16</div>
      <h1 style={{ fontSize: 36, margin: "4px 0 8px", fontWeight: 700 }}>Book a class</h1>
      <p style={{ color: "#555", marginBottom: 32 }}>
        Kids trials and adult intro offers, all in one place.
      </p>
      <Link href="/book" style={primary}>Get started</Link>
      <p style={{ marginTop: 48, fontSize: 12, color: "#888" }}>
        Already a member? Book through MindBody as usual.
      </p>
    </main>
  );
}

const primary: React.CSSProperties = {
  display: "inline-block",
  padding: "14px 22px",
  fontSize: 15,
  fontWeight: 600,
  background: "#111",
  color: "#fff",
  borderRadius: 8,
  textDecoration: "none",
};
