import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Upload, RefreshCcw, CheckCircle2, XCircle, Image as ImageIcon, FileQuestion, Download, PlusCircle, PencilRuler } from "lucide-react";

const DEMO_QUESTIONS = [
  {
    id: "glycolysis-regulated-steps",
    diagramTitle: "Glycolysis Overview",
    imageUrl: "https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?q=80&w=1200&auto=format&fit=crop",
    prompt: "Label the three regulated steps.",
    labels: ["Hexokinase", "PFK-1", "Pyruvate kinase"],
    zones: [
      { id: "z1", x: 14, y: 34, answer: "Hexokinase" },
      { id: "z2", x: 48, y: 50, answer: "PFK-1" },
      { id: "z3", x: 76, y: 72, answer: "Pyruvate kinase" },
    ],
  },
  {
    id: "tca-regulation",
    diagramTitle: "TCA Cycle",
    imageUrl: "https://images.unsplash.com/photo-1530026186672-2cd00ffc50fe?q=80&w=1200&auto=format&fit=crop",
    prompt: "Place the key regulatory enzymes.",
    labels: ["Citrate synthase", "Isocitrate dehydrogenase", "α-Ketoglutarate dehydrogenase"],
    zones: [
      { id: "z1", x: 28, y: 24, answer: "Citrate synthase" },
      { id: "z2", x: 67, y: 31, answer: "Isocitrate dehydrogenase" },
      { id: "z3", x: 56, y: 76, answer: "α-Ketoglutarate dehydrogenase" },
    ],
  },
];

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);

  return lines
    .slice(1)
    .map((line, idx) => {
      const cells = splitCsvLine(line);
      const row = {};
      headers.forEach((h, i) => {
        row[h.trim()] = (cells[i] ?? "").trim();
      });

      return {
        id: row.id || `row-${idx + 1}`,
        diagramTitle: row.diagramTitle || "Untitled Diagram",
        imageUrl: row.imageUrl || "",
        prompt: row.prompt || "Label the diagram.",
        labels: (row.labels || "")
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean),
        zones: (row.zones || "")
          .split("|")
          .map((chunk, zoneIdx) => {
            const [answer, x, y] = chunk.split("@");
            if (!answer || x === undefined || y === undefined) return null;
            return {
              id: `z${zoneIdx + 1}`,
              answer: answer.trim(),
              x: Number(x),
              y: Number(y),
            };
          })
          .filter(Boolean),
      };
    })
    .filter((q) => q.imageUrl && q.labels.length && q.zones.length);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function downloadTextFile(filename, content, type = "application/json") {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function normalizeAnswer(value) {
  return String(value || "").trim().toLowerCase();
}

export default function BiochemLabelStation() {
  const boardRef = useRef(null);
  const [questions, setQuestions] = useState(DEMO_QUESTIONS);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [placements, setPlacements] = useState({});
  const [csvUrl, setCsvUrl] = useState("");
  const [status, setStatus] = useState("Demo mode loaded.");
  const [customPrompt, setCustomPrompt] = useState("");
  const [localImage, setLocalImage] = useState("");
  const [showAnswers, setShowAnswers] = useState(false);
  const [draggingLabel, setDraggingLabel] = useState(null);
  const [teacherMode, setTeacherMode] = useState(false);
  const [teacherAnswer, setTeacherAnswer] = useState("");
  const [teacherLabels, setTeacherLabels] = useState("");
  const [teacherZones, setTeacherZones] = useState([]);
  const [teacherTitle, setTeacherTitle] = useState("Custom Diagram");

  const current = questions[questionIndex] || DEMO_QUESTIONS[0];
  const imageToShow = localImage || current?.imageUrl || "";

  const score = useMemo(() => {
    if (!current) return { correct: 0, total: 0 };
    let correct = 0;
    for (const zone of current.zones) {
      if (normalizeAnswer(placements[zone.id]) === normalizeAnswer(zone.answer)) {
        correct += 1;
      }
    }
    return { correct, total: current.zones.length };
  }, [current, placements]);

  const progress = score.total ? Math.round((score.correct / score.total) * 100) : 0;

  function resetBoard() {
    const cleared = {};
    (current?.zones || []).forEach((z) => {
      cleared[z.id] = "";
    });
    setPlacements(cleared);
    setShowAnswers(false);
  }

  useEffect(() => {
    resetBoard();
  }, [questionIndex]);

  function nextQuestion() {
    setQuestionIndex((prev) => (prev + 1) % questions.length);
  }

  function prevQuestion() {
    setQuestionIndex((prev) => (prev - 1 + questions.length) % questions.length);
  }

  async function loadCsvQuestions() {
    if (!csvUrl.trim()) {
      setStatus("Paste a published Google Sheet CSV URL first.");
      return;
    }

    try {
      setStatus("Loading question bank from sheet...");
      const res = await fetch(csvUrl.trim());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = parseCsv(text);
      if (!parsed.length) throw new Error("No usable rows found in CSV.");
      setQuestions(parsed);
      setQuestionIndex(0);
      setLocalImage("");
      setCustomPrompt("");
      setStatus(`Loaded ${parsed.length} question(s) from Google Sheets.`);
    } catch (error) {
      setStatus(`Could not load the sheet: ${error.message}`);
    }
  }

  function onImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setLocalImage(url);
    setStatus(`Loaded local image: ${file.name}`);
    if (!customPrompt.trim()) setCustomPrompt(`Practice board for ${file.name}`);
  }

  function handleDrop(zoneId) {
    if (!draggingLabel) return;
    setPlacements((prev) => ({ ...prev, [zoneId]: draggingLabel }));
    setDraggingLabel(null);
  }

  function exportSession() {
    const payload = {
      exportedAt: new Date().toISOString(),
      questionId: current?.id,
      diagramTitle: current?.diagramTitle,
      prompt: current?.prompt,
      score,
      placements,
    };
    downloadTextFile(`${current?.id || "session"}-session.json`, JSON.stringify(payload, null, 2));
  }

  function exportTeacherCsvRow() {
    if (!imageToShow) {
      setStatus("Upload an image before exporting a custom teacher-mode row.");
      return;
    }

    const labels = teacherLabels
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);

    const zones = teacherZones.map((z) => `${z.answer}@${Math.round(z.x)}@${Math.round(z.y)}`).join("|");
    const row = [
      `custom-${Date.now()}`,
      teacherTitle || "Custom Diagram",
      imageToShow,
      customPrompt || "Label the diagram.",
      labels.join("|"),
      zones,
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(",");

    const header = '"id","diagramTitle","imageUrl","prompt","labels","zones"';
    downloadTextFile("teacher-mode-row.csv", `${header}\n${row}`, "text/csv;charset=utf-8");
    setStatus("Exported teacher-mode CSV row. You can paste it into your Google Sheet.");
  }

  function handleBoardClick(event) {
    if (!teacherMode || !boardRef.current || !teacherAnswer.trim()) return;
    const rect = boardRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setTeacherZones((prev) => [
      ...prev,
      {
        id: `tz${prev.length + 1}`,
        answer: teacherAnswer.trim(),
        x: clamp(x, 0, 100),
        y: clamp(y, 0, 100),
      },
    ]);
    setTeacherAnswer("");
  }

  function useTeacherBoard() {
    if (!imageToShow || !teacherZones.length) {
      setStatus("Add an image and at least one teacher zone first.");
      return;
    }

    const labels = teacherLabels
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);

    const newQuestion = {
      id: `custom-${Date.now()}`,
      diagramTitle: teacherTitle || "Custom Diagram",
      imageUrl: imageToShow,
      prompt: customPrompt || "Label the diagram.",
      labels: labels.length ? labels : teacherZones.map((z) => z.answer),
      zones: teacherZones.map((z, index) => ({
        id: `z${index + 1}`,
        answer: z.answer,
        x: z.x,
        y: z.y,
      })),
    };

    setQuestions((prev) => [newQuestion, ...prev]);
    setQuestionIndex(0);
    setTeacherMode(false);
    setStatus("Teacher board converted into a live practice question.");
  }

  function clearTeacherZones() {
    setTeacherZones([]);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-3xl border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">Biochem Label Station</CardTitle>
              <p className="mt-1 text-sm text-slate-600">A little pathway gym for diagrams, pathways, and illustrated labeling practice 🧪</p>
            </div>
            <Badge variant="secondary" className="rounded-full px-3 py-1">{score.correct}/{score.total} correct</Badge>
          </CardHeader>

          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              <Button onClick={prevQuestion} variant="outline" className="rounded-2xl">Previous</Button>
              <Button onClick={nextQuestion} className="rounded-2xl">Next Question</Button>
              <Button onClick={resetBoard} variant="outline" className="rounded-2xl"><RefreshCcw className="mr-2 h-4 w-4" />Reset</Button>
              <Button onClick={() => setShowAnswers((v) => !v)} variant="outline" className="rounded-2xl">{showAnswers ? "Hide Answers" : "Show Answers"}</Button>
              <Button onClick={exportSession} variant="outline" className="rounded-2xl"><Download className="mr-2 h-4 w-4" />Save Session</Button>
              <Button onClick={() => setTeacherMode((v) => !v)} variant={teacherMode ? "default" : "outline"} className="rounded-2xl"><PencilRuler className="mr-2 h-4 w-4" />{teacherMode ? "Exit Teacher Mode" : "Teacher Mode"}</Button>
            </div>

            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <FileQuestion className="h-4 w-4" />
                <span className="font-medium text-slate-900">{current?.diagramTitle}</span>
                <span>•</span>
                <span>{customPrompt || current?.prompt}</span>
              </div>
              <div className="mt-2 max-w-md">
                <Progress value={progress} />
              </div>
            </div>

            <div
              ref={boardRef}
              onClick={handleBoardClick}
              className={`relative aspect-[4/3] w-full overflow-hidden rounded-[28px] border bg-white shadow-inner ${teacherMode ? "cursor-crosshair" : "cursor-default"}`}
            >
              {imageToShow ? (
                <img src={imageToShow} alt={current?.diagramTitle || "diagram"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-400">
                  <div className="text-center">
                    <ImageIcon className="mx-auto mb-2 h-10 w-10" />
                    <p>Upload a diagram image to begin.</p>
                  </div>
                </div>
              )}

              {(current?.zones || []).map((zone, idx) => {
                const placed = placements[zone.id];
                const isCorrect = normalizeAnswer(placed) === normalizeAnswer(zone.answer) && placed;
                const text = showAnswers ? zone.answer : placed || `Drop ${idx + 1}`;
                return (
                  <div
                    key={zone.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(zone.id)}
                    className={`absolute min-w-28 -translate-x-1/2 -translate-y-1/2 rounded-2xl border px-3 py-2 text-sm shadow backdrop-blur-sm ${isCorrect ? "border-emerald-300 bg-emerald-100/90" : "border-slate-300 bg-white/90"}`}
                    style={{ left: `${clamp(zone.x, 5, 95)}%`, top: `${clamp(zone.y, 5, 95)}%` }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs text-white">{idx + 1}</span>
                      <span>{text}</span>
                      {placed ? isCorrect ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-500" /> : null}
                    </div>
                  </div>
                );
              })}

              {teacherMode && teacherZones.map((zone, idx) => (
                <div
                  key={zone.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-indigo-500 bg-white px-2 py-1 text-xs font-medium shadow"
                  style={{ left: `${clamp(zone.x, 3, 97)}%`, top: `${clamp(zone.y, 3, 97)}%` }}
                >
                  {idx + 1}. {zone.answer}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card className="rounded-3xl border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl">Label Bank</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {(current?.labels || []).map((label) => (
                  <div
                    key={label}
                    draggable
                    onDragStart={() => setDraggingLabel(label)}
                    className="cursor-grab rounded-2xl border bg-white px-4 py-3 text-sm shadow-sm active:cursor-grabbing"
                  >
                    {label}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl">Data + Import</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium">Google Sheet CSV URL</p>
                <Input value={csvUrl} onChange={(e) => setCsvUrl(e.target.value)} placeholder="Paste published CSV URL here" className="rounded-2xl" />
                <Button onClick={loadCsvQuestions} className="mt-3 w-full rounded-2xl">Load Sheet Question Bank</Button>
                <p className="mt-2 text-xs text-slate-500">Use a published CSV link from Google Sheets for the GitHub Pages version.</p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Upload Diagram</p>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center">
                  <Upload className="mb-2 h-8 w-8" />
                  <span className="font-medium">Upload PNG or JPG</span>
                  <span className="mt-1 text-xs text-slate-500">Great for custom pathway boards and lecture screenshots.</span>
                  <input type="file" accept="image/*" className="hidden" onChange={onImageUpload} />
                </label>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Prompt</p>
                <Textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="Optional custom prompt" className="min-h-24 rounded-2xl" />
              </div>

              <div>
                <p className="text-sm font-medium">Status</p>
                <div className="mt-1 rounded-2xl bg-slate-100 p-3 text-sm">{status}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl">Teacher Mode</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input value={teacherTitle} onChange={(e) => setTeacherTitle(e.target.value)} placeholder="Diagram title" className="rounded-2xl" />
              <Input value={teacherLabels} onChange={(e) => setTeacherLabels(e.target.value)} placeholder="Labels separated by | e.g. ATP|NADH|FADH2" className="rounded-2xl" />
              <div className="flex gap-2">
                <Input value={teacherAnswer} onChange={(e) => setTeacherAnswer(e.target.value)} placeholder="Enter label, then click image to place" className="rounded-2xl" />
                <Button variant="outline" className="rounded-2xl" onClick={() => setTeacherMode(true)}><PlusCircle className="mr-2 h-4 w-4" />Arm</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={useTeacherBoard} className="rounded-2xl">Use as Practice Board</Button>
                <Button onClick={exportTeacherCsvRow} variant="outline" className="rounded-2xl">Export CSV Row</Button>
                <Button onClick={clearTeacherZones} variant="outline" className="rounded-2xl">Clear Teacher Zones</Button>
              </div>
              <div className="rounded-2xl bg-slate-100 p-3 text-sm">
                {teacherZones.length ? teacherZones.map((z, i) => `${i + 1}. ${z.answer} @ ${Math.round(z.x)}%, ${Math.round(z.y)}%`).join("\n") : "No teacher zones placed yet."}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
