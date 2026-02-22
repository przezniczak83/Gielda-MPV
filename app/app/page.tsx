"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/news")
      .then(res => res.json())
      .then(json => setData(json.data ?? []));
  }, []);

  return (
    <div style={{ padding: 40 }}>
      <h1>NEWS LIST</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}