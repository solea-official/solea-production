"use client";
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "Arial",
          padding: 40,
          background: "#FFFDF7",
          color: "#4F5B2D",
        }}
      >
        <h1>SOLÉA</h1>
        <p>We are temporarily unavailable. Please try again shortly.</p>
        <p dir="rtl">الخدمة غير متاحة مؤقتًا. يُرجى المحاولة بعد قليل.</p>
        <button onClick={reset}>Try again / إعادة المحاولة</button>
      </body>
    </html>
  );
}
