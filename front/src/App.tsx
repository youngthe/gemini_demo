// App.tsx
import { useState } from "react";
import "./App.css";

function App() {
  const [input, setInput] = useState<string>("");
  const [reply, setReply] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // 🔸 카카오 로그인 버튼 클릭 시: 백엔드의 로그인 시작 URL로 이동
  const handleKakaoLogin = () => {
    window.location.href = "http://localhost:3001/login/kakao";
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    setLoading(true);
    setError("");
    setReply("");

    try {
      const res = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: input }),
      });

      if (!res.ok) {
        let data: { error?: string } = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }
        throw new Error(data.error || "요청 실패");
      }

      const data: { text?: string } = await res.json();
      setReply(data.text || "(빈 응답)");
    } catch (err: unknown) {
      console.error(err);
      if (err instanceof Error) {
        setError(err.message || "알 수 없는 오류가 발생했습니다.");
      } else {
        setError("알 수 없는 오류가 발생했습니다.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="app">
      <div className="chat-card">
       <header className="chat-header">
          <div>
            <h1> 영미나이 </h1>
          </div>

          {/* 🔸 카카오 로그인 버튼을 우측으로 이동 */}
          <div className="kakao-login-wrapper">
            <button className="btn kakao-btn" onClick={handleKakaoLogin}>
              대화 내용 카카오톡으로 전송
            </button>
          </div>
        </header>

        <section className="chat-input-section">
          <div className="textarea-wrapper">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              placeholder=''
            />
          </div>
          <div className="button-row">
            <button
              className="btn btn-primary"
              onClick={handleSend}
              disabled={loading}
            >
              {loading ? "생각 중..." : "보내기"}
            </button>
          </div>
        </section>

        <section className="chat-output-section">
          <div className="output-box">
            {loading && (
              <div className="status-row">
                <span className="spinner" />
                <span>답변을 생성 중입니다...</span>
              </div>
            )}

            {!loading && error && (
              <div className="status-row error">
                <span>❌ {error}</span>
              </div>
            )}

            {!loading && !error && !reply && (
              <div className="placeholder-text">
              </div>
            )}

            {!loading && !error && reply && (
              <div className="reply-text">
                {reply}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
