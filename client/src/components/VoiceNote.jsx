import { useEffect, useRef, useState } from 'react';
import { tickets } from '../lib/tickets.js';

const RECORDER_SUPPORTED = typeof window !== 'undefined' && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? '';
}

// Records via MediaRecorder or accepts an uploaded audio file, transcribes it,
// and hands the transcript text back for the user to review/edit - never
// auto-submits anything itself.
export default function VoiceNote({ onTranscript }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const transcribe = async (blob, mimeType) => {
    setBusy(true);
    setError(null);
    try {
      const base64 = await blobToBase64(blob);
      const { transcript } = await tickets.transcribeVoice(base64, mimeType);
      onTranscript(transcript);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timerRef.current);
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        transcribe(blob, mimeType || 'audio/webm');
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s >= 119) {
            recorder.stop();
            setRecording(false);
            return s;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      setError('Microphone access denied or unavailable — you can still upload an audio file below.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const onFileSelected = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    transcribe(file, file.type || 'audio/webm');
  };

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-cream-400 p-2.5">
      {RECORDER_SUPPORTED && (
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          disabled={busy}
          className={`rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
            recording ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-clay-500 text-white hover:bg-clay-600'
          }`}
        >
          {recording ? `⏹ Stop (${mmss})` : '🎤 Record voice note'}
        </button>
      )}
      <label className="cursor-pointer rounded-full border border-cream-400 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-cream-200">
        Upload audio file
        <input type="file" accept="audio/*" onChange={onFileSelected} disabled={busy} className="hidden" />
      </label>
      {busy && <span className="text-xs text-ink-500">Transcribing…</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
