import type * as monaco from "monaco-editor";

const extensionLanguageMap: Record<string, string> = {
  bash: "shell",
  c: "cpp",
  cc: "cpp",
  cjs: "javascript",
  conf: "nginx",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  env: "ini",
  go: "go",
  h: "cpp",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  less: "css",
  log: "plaintext",
  lua: "lua",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  php: "php",
  properties: "ini",
  props: "ini",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sass: "css",
  scss: "css",
  service: "ini",
  sh: "shell",
  socket: "ini",
  sql: "sql",
  timer: "ini",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  vue: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

const filenameLanguageMap: Record<string, string> = {
  ".bash_profile": "shell",
  ".bashrc": "shell",
  ".dockerignore": "plaintext",
  ".env": "ini",
  ".gitconfig": "ini",
  ".gitignore": "plaintext",
  ".profile": "shell",
  ".zprofile": "shell",
  ".zshrc": "shell",
  "apache2.conf": "nginx",
  "dockerfile": "dockerfile",
  "makefile": "makefile",
  "nginx.conf": "nginx",
};

const compoundExtensionLanguageMap: Record<string, string> = {
  "compose.yaml": "yaml",
  "compose.yml": "yaml",
  "docker-compose.yaml": "yaml",
  "docker-compose.yml": "yaml",
};

let customLanguagesRegistered = false;

export function registerRemoteFileEditorLanguages(monacoApi: typeof monaco) {
  if (customLanguagesRegistered) {
    return;
  }
  customLanguagesRegistered = true;

  registerLanguage(monacoApi, "toml", ["toml"], ["TOML"], tomlLanguage());
  registerLanguage(monacoApi, "ini", ["ini", "conf", "env", "properties", "service", "timer", "socket"], ["INI"], iniLanguage());
  registerLanguage(monacoApi, "dockerfile", ["dockerfile"], ["Dockerfile"], dockerfileLanguage());
  registerLanguage(monacoApi, "nginx", ["conf"], ["Nginx config"], nginxLanguage());
  registerLanguage(monacoApi, "shell", ["sh", "bash", "zsh"], ["Shell"], shellLanguage());
  registerLanguage(monacoApi, "yaml", ["yaml", "yml"], ["YAML"], yamlLanguage());
  registerLanguage(monacoApi, "sql", ["sql"], ["SQL"], sqlLanguage());
  registerLanguage(monacoApi, "xml", ["xml"], ["XML"], xmlLanguage());
  registerCodeLikeLanguage(monacoApi, "python", ["py"], ["Python"]);
  registerCodeLikeLanguage(monacoApi, "rust", ["rs"], ["Rust"]);
  registerCodeLikeLanguage(monacoApi, "go", ["go"], ["Go"]);
  registerCodeLikeLanguage(monacoApi, "php", ["php"], ["PHP"]);
  registerCodeLikeLanguage(monacoApi, "ruby", ["rb"], ["Ruby"]);
  registerCodeLikeLanguage(monacoApi, "java", ["java"], ["Java"]);
  registerCodeLikeLanguage(monacoApi, "cpp", ["c", "cc", "cpp", "cxx", "h", "hpp"], ["C++"]);
}

export function remoteFileLanguageForPath(path: string) {
  const filename = remoteFileName(path).toLowerCase();
  const knownFilenameLanguage = filenameLanguageMap[filename];
  if (knownFilenameLanguage) {
    return knownFilenameLanguage;
  }

  const knownCompoundExtension = Object.entries(compoundExtensionLanguageMap).find(([suffix]) =>
    filename.endsWith(`.${suffix}`) || filename === suffix,
  );
  if (knownCompoundExtension) {
    return knownCompoundExtension[1];
  }

  const extension = filename.includes(".") ? filename.split(".").pop() || "" : "";
  return extensionLanguageMap[extension] || "plaintext";
}

export function remoteFileName(path: string) {
  return path.split("/").filter(Boolean).pop() || path || "untitled";
}

function registerLanguage(
  monacoApi: typeof monaco,
  id: string,
  extensions: string[],
  aliases: string[],
  language: monaco.languages.IMonarchLanguage,
) {
  if (!monacoApi.languages.getLanguages().some((item) => item.id === id)) {
    monacoApi.languages.register({
      id,
      extensions: extensions.map((extension) => `.${extension}`),
      aliases: [id, ...aliases],
    });
  }
  monacoApi.languages.setMonarchTokensProvider(id, language);
}

function registerCodeLikeLanguage(
  monacoApi: typeof monaco,
  id: string,
  extensions: string[],
  aliases: string[],
) {
  registerLanguage(monacoApi, id, extensions, aliases, codeLikeLanguage());
}

function tomlLanguage(): monaco.languages.IMonarchLanguage {
  return {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/^\s*\[\[?[^\]]+\]\]?/, "keyword"],
        [/^\s*[A-Za-z0-9_.-]+(?=\s*=)/, "attribute.name"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@stringDouble"],
        [/'[^']*'/, "string"],
        [/\b(true|false)\b/, "keyword"],
        [/\b\d+(\.\d+)?\b/, "number"],
      ],
    },
    stringDouble: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],
  };
}

function iniLanguage(): monaco.languages.IMonarchLanguage {
  return {
    tokenizer: {
      root: [
        [/[#;].*$/, "comment"],
        [/^\s*\[[^\]]+\]/, "keyword"],
        [/^\s*[^=\s]+(?=\s*=)/, "attribute.name"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b(true|false|yes|no|on|off|null)\b/i, "keyword"],
        [/\b\d+(\.\d+)?\b/, "number"],
      ],
    },
  };
}

function dockerfileLanguage(): monaco.languages.IMonarchLanguage {
  return {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/^\s*(FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/i, "keyword"],
        [/\$[{(]?[A-Za-z_][A-Za-z0-9_]*[})]?/, "variable"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b\d+\b/, "number"],
      ],
    },
  };
}

function nginxLanguage(): monaco.languages.IMonarchLanguage {
  return {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/[{};]/, "delimiter"],
        [/^\s*[A-Za-z_][\w.-]*/, "keyword"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'[^']*'/, "string"],
        [/\$[A-Za-z_][\w]*/, "variable"],
        [/\b\d+[kKmMgG]?\b/, "number"],
      ],
    },
  };
}

function shellLanguage(): monaco.languages.IMonarchLanguage {
  return {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|in|export|local|return|exit)\b/, "keyword"],
        [/\$[{(]?[A-Za-z_][A-Za-z0-9_]*[})]?/, "variable"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b\d+\b/, "number"],
      ],
    },
  };
}

function yamlLanguage(): monaco.languages.IMonarchLanguage {
  return {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/^\s*[-?]?\s*[A-Za-z0-9_.-]+(?=\s*:)/, "attribute.name"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b(true|false|null|yes|no|on|off)\b/i, "keyword"],
        [/\b\d+(\.\d+)?\b/, "number"],
      ],
    },
  };
}

function sqlLanguage(): monaco.languages.IMonarchLanguage {
  return {
    ignoreCase: true,
    tokenizer: {
      root: [
        [/--.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/\b(select|from|where|insert|into|update|delete|create|alter|drop|join|left|right|inner|outer|group|order|by|limit|values|set|and|or|not|null|is|as|on|table|index|view)\b/, "keyword"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/\b\d+(\.\d+)?\b/, "number"],
      ],
      comment: [
        [/[^*/]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[*/]/, "comment"],
      ],
    },
  };
}

function xmlLanguage(): monaco.languages.IMonarchLanguage {
  return {
    tokenizer: {
      root: [
        [/<!--/, "comment", "@comment"],
        [/<\/?[A-Za-z_][\w.-]*/, "tag"],
        [/[A-Za-z_][\w.-]*(?=\=)/, "attribute.name"],
        [/"[^"]*"/, "attribute.value"],
        [/'[^']*'/, "attribute.value"],
        [/[<>\/=]/, "delimiter"],
      ],
      comment: [
        [/[^-]+/, "comment"],
        [/-->/, "comment", "@pop"],
        [/-/, "comment"],
      ],
    },
  };
}

function codeLikeLanguage(): monaco.languages.IMonarchLanguage {
  return {
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/#.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/\b(class|def|fn|func|function|return|if|else|for|while|switch|case|break|continue|import|from|package|use|let|const|var|pub|private|public|static|new|try|catch|finally|throw|async|await)\b/, "keyword"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/\b\d+(\.\d+)?\b/, "number"],
      ],
      comment: [
        [/[^*/]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[*/]/, "comment"],
      ],
    },
  };
}
