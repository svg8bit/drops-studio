"use client";

import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

import type { ProjectFileLanguageV2 } from "../lib/project-v2-types.ts";

export interface ProjectV2CodeEditorProps {
  value: string;
  language: ProjectFileLanguageV2;
  readOnly?: boolean;
  ariaLabel?: string;
  onChange: (value: string) => void;
}

export default function ProjectV2CodeEditor({
  value,
  language,
  readOnly = false,
  ariaLabel = "Project source editor",
  onChange,
}: ProjectV2CodeEditorProps) {
  const extensions = useMemo(() => {
    switch (language) {
      case "css":
        return [css()];
      case "html":
        return [html({ autoCloseTags: true, matchClosingTags: true })];
      case "javascript":
        return [javascript()];
      case "jsx":
        return [javascript({ jsx: true })];
      case "typescript":
        return [javascript({ typescript: true })];
      case "tsx":
        return [javascript({ jsx: true, typescript: true })];
      case "json":
        return [json()];
      default:
        return [];
    }
  }, [language]);

  return (
    <CodeMirror
      aria-label={ariaLabel}
      basicSetup={{
        autocompletion: true,
        bracketMatching: true,
        closeBrackets: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        highlightSelectionMatches: true,
        lineNumbers: true,
      }}
      editable={!readOnly}
      extensions={extensions}
      height="100%"
      onCreateEditor={(view) => {
        view.contentDOM.setAttribute("aria-label", ariaLabel);
        view.scrollDOM.setAttribute("aria-label", `${ariaLabel} scroll region`);
        view.scrollDOM.setAttribute("tabindex", "0");
      }}
      onChange={onChange}
      readOnly={readOnly}
      theme="light"
      value={value}
    />
  );
}
