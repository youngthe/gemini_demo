import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from "express";
import cors from "cors";
import session from "express-session";
import axios from "axios";
import qs from "qs";
import mysql from "mysql2/promise";

const apiKey = process.env.GEMINI_API_KEY;
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;

let lastGeminiReply = "";

// 환경변수 체크
if (!apiKey) {
  console.error("❌ GEMINI_API_KEY 환경변수가 없습니다.");
  process.exit(1);
}

const app = express();
const port = 3001;

const KAKAO_REDIRECT_URI = "http://localhost:3001/oauth/kakao/callback";

/* ---------------------------------------------------------------------
  ✅ MySQL Pool
------------------------------------------------------------------------ */
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "news_app",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
});

/* ---------------------------------------------------------------------
  미들웨어
------------------------------------------------------------------------ */
app.use(cors());
app.use(express.json());
app.use(
  session({
    secret: "kakao-secret",
    resave: false,
    saveUninitialized: true,
  })
);

// Gemini 모델 초기화
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/* ---------------------------------------------------------------------
  📌 오늘 데이터 저장 공간 (메모리) - news는 MySQL로 전환
------------------------------------------------------------------------ */
const todayData = {
  luck: [],
  jokes: [],
  stocks: [],
};

/* ---------------------------------------------------------------------
  📌 카테고리별 Gemini 프롬프트 생성
------------------------------------------------------------------------ */
function buildPromptForCategory(category) {
  switch (category) {
    case "luck":
      return `
너는 JSON만 출력하는 생성기다.
"오늘의 운세"에 맞는 한국어 텍스트를 생성해라.

조건:
- 배열 형태의 JSON만 출력한다.
- 각 요소는 { "title": string, "content": string } 형식이다.
- title은 10자 이내, content는 80자 이내로 한다.
- content는 오늘 하루의 전반적인 운, 금전운, 연애운 등을 간단히 조언 형식으로 적는다.
- 설명 문장, 코드 블록(\`\`\`) 등 JSON 이외의 문자는 절대 출력하지 마라.
- 최근에 응답했던 결과값은 제외하고 응답한다.

예시 형식:
[
  { "title": "오늘의 운세", "content": "..." },
  { "title": "금전 운", "content": "..." }
]
`;

    case "jokes":
      return `
너는 JSON만 출력하는 생성기다.
"아재개그"에 해당하는 한국어 개그를 몇 개 만든다.

조건:
- 배열 형태의 JSON만 출력한다.
- 각 요소는 { "title": string, "content": string } 형식이다.
- title에는 개그 제목이나 질문을 넣고, content에는 답 또는 한 줄 개그를 적는다.
- 설명 문장, 코드 블록(\`\`\`) 등 JSON 이외의 문자는 절대 출력하지 마라.
- 최근에 응답했던 결과값은 제외하고 응답한다.
- 8가지 이상 결과값을 반환한다.

예시 형식:
[
  { "title": "소금이 죽으면?", "content": "염장 지른다." },
  { "title": "컴퓨터가 싫어하는 술은?", "content": "버그주." }
]
`;

    case "stocks":
      return `
너는 JSON만 출력하는 생성기다.
"오늘의 주식" 코멘트를 한국어로 만든다.

조건:
- 배열 형태의 JSON만 출력한다.
- 각 요소는 { "title": string, "content": string } 형식이다.
- title에는 국내 또는 글로벌 주식/섹터 이름을 적는다. (예: 삼성전자, 2차전지 섹터)
- content에는 오늘 시장에 대한 간단한 전망이나 유의사항을 80자 이내로 작성한다.
- 투자 권유가 아닌 참고용 멘트로 적어라.
- 설명 문장, 코드 블록(\`\`\`) 등 JSON 이외의 문자는 절대 출력하지 마라.
- 최근에 응답했던 결과값은 제외하고 응답한다.
`;

    default:
      return "[]";
  }
}

/* ---------------------------------------------------------------------
  📌 Gemini로 데이터 생성 → todayData 갱신
------------------------------------------------------------------------ */
async function refreshCategory(category) {
  try {
    const prompt = buildPromptForCategory(category);
    const result = await model.generateContent(prompt);

    let text = result.response.text().trim();

    // ```json 제거
    if (text.startsWith("```")) {
      text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
    }

    const parsed = JSON.parse(text);

    if (Array.isArray(parsed) && parsed.length > 0) {
      todayData[category] = parsed;
      console.log(`✅ [${category}] 데이터 갱신 완료`);
    }
  } catch (err) {
    console.error(`❌ [${category}] 갱신 실패:`, err.message);
  }
}

/* ---------------------------------------------------------------------
  📌 모든 카테고리 한번에 갱신 (news 제외)
------------------------------------------------------------------------ */
async function refreshAllTodayData() {
  console.log("🔄 Gemini 데이터 갱신 시작");
  await Promise.all([refreshCategory("luck"), refreshCategory("jokes"), refreshCategory("stocks")]);
  console.log("🔄 Gemini 데이터 갱신 완료");
}

/* ---------------------------------------------------------------------
  📌 서버 시작 시 1회 갱신 + 1시간마다 자동 갱신
------------------------------------------------------------------------ */
refreshAllTodayData();
setInterval(refreshAllTodayData, 60 * 60 * 1000); // 1시간마다 실행

/* ---------------------------------------------------------------------
  ✅ React Native 호환 형태로 변환 (news + comments)
  - RN mapApiToItems가 기대하는 형태:
    {
      id, title, content,
      comments: [{ id, text, createdAt }],
      command: { type:"add_comment", endpoint, method, payload:{newsId} }
    }
------------------------------------------------------------------------ */
function toNewsResponseRow(newsRow, commentsRows) {
  return {
    id: String(newsRow.id),
    title: newsRow.title,
    content: newsRow.content,
    comments: commentsRows.map((c) => ({
      id: String(c.id),
      text: `${c.nickname}: ${c.comment_text}`,
      createdAt: c.created_at ? new Date(c.created_at).toISOString() : undefined,
    })),
    command: {
      type: "add_comment",
      endpoint: "/today/news/comments",
      method: "POST",
      payload: { newsId: String(newsRow.id) },
    },
  };
}

/* ---------------------------------------------------------------------
  📌 오늘 데이터 API (luck/jokes/stocks는 기존)
------------------------------------------------------------------------ */
app.get("/today/luck", (req, res) => res.json(todayData.luck));
app.get("/today/jokes", (req, res) => res.json(todayData.jokes));
app.get("/today/stocks", (req, res) => res.json(todayData.stocks));

/* ---------------------------------------------------------------------
  ✅ news: MySQL에서 가져오기 (news + comments)
  - 최신순 뉴스 N개 (기본 20개)
  - comments는 오래된순
------------------------------------------------------------------------ */
app.get("/today/news", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 20);
    const [newsRows] = await pool.query(
      `
      SELECT id, title, content, created_at, updated_at
      FROM news
      ORDER BY created_at DESC
      LIMIT ?
      `,
      [limit]
    );

    if (!Array.isArray(newsRows) || newsRows.length === 0) {
      return res.json([]); // RN에서 empty 처리됨
    }

    const newsIds = newsRows.map((n) => n.id);

    // comments 한번에 조회
    const [commentRows] = await pool.query(
      `
      SELECT id, news_id, nickname, comment_text, created_at
      FROM news_comments
      WHERE news_id IN (?)
      ORDER BY created_at ASC
      `,
      [newsIds]
    );

    // news_id로 그룹핑
    const commentsByNewsId = new Map();
    if (Array.isArray(commentRows)) {
      for (const c of commentRows) {
        const key = String(c.news_id);
        if (!commentsByNewsId.has(key)) commentsByNewsId.set(key, []);
        commentsByNewsId.get(key).push(c);
      }
    }

    const result = newsRows.map((n) => {
      const comments = commentsByNewsId.get(String(n.id)) || [];
      return toNewsResponseRow(n, comments);
    });

    res.json(result);
  } catch (err) {
    console.error("❌ /today/news 오류:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

/* ---------------------------------------------------------------------
  ✅ 댓글 등록: MySQL INSERT
  RN에서 보내는 payload 예시:
  {
    command:"add_comment",
    newsId:"1",
    title:"...",
    text:"댓글",
    createdAt:"ISO",
    client:{platform:"android"}
  }
------------------------------------------------------------------------ */
app.post("/today/news/comments", async (req, res) => {
  try {
    const { newsId, text, nickname } = req.body;

    const cleanNewsId = String(newsId || "").trim();
    const cleanText = String(text || "").trim();
    const cleanNickname = String(nickname || "익명").trim().slice(0, 50);

    if (!cleanNewsId) return res.status(400).json({ error: "newsId가 필요합니다." });
    if (!cleanText) return res.status(400).json({ error: "text가 필요합니다." });

    // 해당 news 존재 확인(선택이지만 안전)
    const [existsRows] = await pool.query(`SELECT id FROM news WHERE id = ? LIMIT 1`, [cleanNewsId]);
    if (!Array.isArray(existsRows) || existsRows.length === 0) {
      return res.status(404).json({ error: "존재하지 않는 newsId 입니다." });
    }

    const [insertResult] = await pool.query(
      `
      INSERT INTO news_comments (news_id, nickname, comment_text)
      VALUES (?, ?, ?)
      `,
      [cleanNewsId, cleanNickname, cleanText]
    );

    const insertedId = insertResult?.insertId;

    // 방금 저장한 댓글 다시 읽어서 반환 (RN 코드가 returned.comment 사용)
    const [rows] = await pool.query(
      `
      SELECT id, news_id, nickname, comment_text, created_at
      FROM news_comments
      WHERE id = ?
      LIMIT 1
      `,
      [insertedId]
    );

    const c = Array.isArray(rows) && rows[0] ? rows[0] : null;

    res.json({
      ok: true,
      comment: c
        ? {
            id: String(c.id),
            newsId: String(c.news_id),
            text: `${c.nickname}: ${c.comment_text}`,
            createdAt: c.created_at ? new Date(c.created_at).toISOString() : new Date().toISOString(),
          }
        : {
            id: String(insertedId),
            newsId: cleanNewsId,
            text: `${cleanNickname}: ${cleanText}`,
            createdAt: new Date().toISOString(),
          },
    });
  } catch (err) {
    console.error("❌ /today/news/comments 오류:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

app.get("/admin", (req, res) => {
  res.type("html").send(`
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>뉴스 업로드</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 20px; max-width: 900px; margin: 0 auto; }
    textarea { width: 100%; height: 260px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    button { padding: 10px 14px; cursor: pointer; }
    .row { display: flex; gap: 10px; margin: 10px 0; flex-wrap: wrap; }
    pre { background: #111; color: #0f0; padding: 12px; overflow: auto; border-radius: 8px; }
    .hint { color: #555; }
  </style>
</head>
<body>
  <h1>뉴스 JSON 업로드</h1>
  <p class="hint">아래 텍스트박스에 뉴스 배열(JSON)을 넣고 "서버로 보내기" 클릭</p>
  <p> 아래 내용 요약해주는데, 친절하게 설명해줘, 조건 1. json 형태로, 제목을 title, 내용을 content로 줘 2. 내용을 10개로 정리해줘 </p>
  <textarea id="jsonInput">[
  {
    "title": "예시 뉴스",
    "content": "내용을 여기에 넣으세요"
  }
]</textarea>

  <div class="row">
    <button id="sendBtn">서버로 보내기 (POST /api/news)</button>
    <button id="loadBtn">서버 데이터 보기 (GET /api/news)</button>
    <button id="clearBtn">서버 데이터 초기화 (POST /api/news/clear)</button>
  </div>

  <h3>결과</h3>
  <pre id="result">{}</pre>

  <script>
    const $ = (id) => document.getElementById(id);

    function show(obj) {
      $("result").textContent = JSON.stringify(obj, null, 2);
    }

    $("sendBtn").addEventListener("click", async () => {
      try {
        const parsed = JSON.parse($("jsonInput").value);

        const res = await fetch("/api/news", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        });

        const data = await res.json();
        show(data);
      } catch (e) {
        show({ error: "JSON 파싱 또는 요청 실패", detail: String(e) });
      }
    });

    $("loadBtn").addEventListener("click", async () => {
      const res = await fetch("/api/news");
      const data = await res.json();
      show(data);
    });

    $("clearBtn").addEventListener("click", async () => {
      const res = await fetch("/api/news/clear", { method: "POST" });
      const data = await res.json();
      show(data);
    });
  </script>
</body>
</html>
  `);
});



// 3) 뉴스 JSON을 서버로 받는 API (배열 형태) -> ✅ DB 저장
app.post("/api/news", async (req, res) => {
  try {
    const newsList = req.body;

    if (!Array.isArray(newsList)) {
      return res.status(400).json({ message: "배열(JSON Array) 형태로 보내야 합니다." });
    }

    // title/content만 추려서 정리 + 빈 값 제거 + title 길이 제한
    const cleaned = newsList
      .map((item) => ({
        title: String(item?.title ?? "").trim().slice(0, 255),
        content: String(item?.content ?? "").trim(),
      }))
      .filter((n) => n.title.length > 0 || n.content.length > 0);

    if (cleaned.length === 0) {
      return res.status(400).json({ message: "저장할 데이터가 없습니다." });
    }

    // ✅ Bulk Insert (트랜잭션)
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const placeholders = cleaned.map(() => "(?, ?)").join(", ");
      const values = cleaned.flatMap((x) => [x.title, x.content]);

      const [result] = await conn.query(
        `INSERT INTO news (title, content) VALUES ${placeholders}`,
        values
      );

      await conn.commit();

      res.json({
        message: "DB 저장 완료",
        savedCount: cleaned.length,
        affectedRows: result?.affectedRows ?? cleaned.length,
        firstInsertId: String(result?.insertId ?? ""),
      });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error("❌ /api/news DB 저장 실패:", e);
    res.status(500).json({ message: "DB 저장 실패", error: String(e?.message || e) });
  }
});

// ✅ 서버 데이터 보기 (GET /api/news) -> DB 조회
app.get("/api/news", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 25), 50);

    const [rows] = await pool.query(
      `
      SELECT id, title, content, created_at
      FROM news
      ORDER BY created_at DESC
      LIMIT ?
      `,
      [limit]
    );

    res.json(
      Array.isArray(rows)
        ? rows.map((r) => ({
            id: String(r.id),
            title: r.title,
            content: r.content,
            createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
          }))
        : []
    );
  } catch (e) {
    console.error("❌ /api/news 조회 실패:", e);
    res.status(500).json({ message: "DB 조회 실패", error: String(e?.message || e) });
  }
});

/* ---------------------------------------------------------------------
  📌 Gemini Chat API (기존 기능 유지)
------------------------------------------------------------------------ */
app.post("/api/chat", async (req, res) => {
  try {
    let { message } = req.body;
    message += " 응답을 3가지 요약 + 추천 근거 포함, 150자 이내.";

    const result = await model.generateContent(message);
    const text = result.response.text();

    lastGeminiReply = text;

    res.json({ text });
  } catch (err) {
    console.error("❌ Chat 오류:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

/* ---------------------------------------------------------------------
  📌 카카오 메시지 전송 (기존 유지)
------------------------------------------------------------------------ */
app.get("/login/kakao", (req, res) => {
  req.session.kakaoAccessToken = null;

  const kakaoAuthUrl =
    "https://kauth.kakao.com/oauth/authorize?" +
    `client_id=${KAKAO_REST_API_KEY}&` +
    `redirect_uri=${encodeURIComponent(KAKAO_REDIRECT_URI)}&` +
    "response_type=code&scope=talk_message&prompt=consent";

  res.redirect(kakaoAuthUrl);
});

app.get("/oauth/kakao/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const tokenRes = await axios.post(
      "https://kauth.kakao.com/oauth/token",
      qs.stringify({
        grant_type: "authorization_code",
        client_id: KAKAO_REST_API_KEY,
        redirect_uri: KAKAO_REDIRECT_URI,
        code,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;
    req.session.kakaoAccessToken = accessToken;

    const text = lastGeminiReply.trim() || "안녕하세요! (아직 Gemini 응답이 없습니다.)";

    await axios.post(
      "https://kapi.kakao.com/v2/api/talk/memo/default/send",
      qs.stringify({
        template_object: JSON.stringify({
          object_type: "text",
          text,
          link: {
            web_url: "https://example.com",
            mobile_web_url: "https://example.com",
          },
        }),
      }),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    res.send(`<h2>카카오 메시지 전송 성공!</h2>`);
  } catch (err) {
    console.error("❌ Kakao Error:", err.response?.data || err);
    res.send("카카오 로그인 오류");
  }
});

/* ---------------------------------------------------------------------
  📌 서버 시작
------------------------------------------------------------------------ */
app.listen(port, async () => {
  try {
    // 시작 시 DB 연결 테스트
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log("✅ MySQL 연결 성공");
  } catch (e) {
    console.error("❌ MySQL 연결 실패:", e?.message || e);
  }

  console.log(`🚀 서버 실행됨 → http://localhost:${port}`);
});