import { readFileSync } from "node:fs";

const useCredentials = readFileSync("src/features/connections/useCredentials.ts", "utf8");
const connectionTypes = readFileSync("src/features/connections/connectionTypes.ts", "utf8");
const settingsView = readFileSync("src/features/settings/SettingsView.tsx", "utf8");
const styles = readFileSync("src/styles/app.css", "utf8");
const dialog = readFileSync("src/shared/tauri/dialog.ts", "utf8");
const frontendContract = readFileSync(".trellis/spec/frontend/tauri-command-contracts.md", "utf8");
const backendContract = readFileSync(".trellis/spec/backend/tauri-command-contracts.md", "utf8");
const credentialsRs = readFileSync("src-tauri/src/credentials/mod.rs", "utf8");

const normalizeMatch = useCredentials.match(
  /function normalizeCredentialInput\([^)]*\): CredentialProfileInput \{[\s\S]*?\n\}/,
);
if (!normalizeMatch) {
  throw new Error("useCredentials should define normalizeCredentialInput.");
}

if (!/username:\s*trim\(input\.username\)/.test(normalizeMatch[0])) {
  throw new Error("normalizeCredentialInput should preserve and trim account username.");
}

for (const [sourceName, source] of [
  ["connectionTypes.ts", connectionTypes],
  ["credentials/mod.rs", credentialsRs],
  ["frontend contract", frontendContract],
  ["backend contract", backendContract],
]) {
  if (!source.includes("username")) {
    throw new Error(`${sourceName} should include credential account username in the contract.`);
  }
}

for (const sourceNeedle of [
  "请填写账号用户名",
  "credential_username_missing",
  "Credential password auth has blank username",
  "Credential private-key auth has blank username",
]) {
  if (!backendContract.includes(sourceNeedle) && !credentialsRs.includes(sourceNeedle)) {
    throw new Error(`Credential username validation contract should mention ${sourceNeedle}.`);
  }
}

for (const copyNeedle of [
  "密码账号",
  "私钥账号",
  "账号包含用户名和认证材料",
  "用户名 + 密码或私钥",
  "credential.username",
]) {
  if (!settingsView.includes(copyNeedle)) {
    throw new Error(`Credential settings copy should describe account semantics: ${copyNeedle}`);
  }
}

if (!credentialsRs.includes("请填写账号私钥路径。")) {
  throw new Error("Private-key account validation should ask for an account private-key path.");
}

if (!dialog.includes("selectLocalPrivateKeyFile") || !dialog.includes("选择私钥文件")) {
  throw new Error("shared Tauri dialog helpers should expose a private-key file picker.");
}

for (const pickerNeedle of [
  "selectLocalPrivateKeyFile",
  "选择账号私钥文件",
  "credential-private-key-picker",
]) {
  if (!settingsView.includes(pickerNeedle)) {
    throw new Error(`Credential settings should wire the private-key file picker: ${pickerNeedle}`);
  }
}

const secretFieldStyle = styles.match(/\.credential-secret-field\s*\{[\s\S]*?\n\}/)?.[0] || "";
if (!secretFieldStyle.includes("width: 100%") || !secretFieldStyle.includes("box-sizing: border-box")) {
  throw new Error("credential-secret-field should be width-constrained with border-box sizing.");
}

const secretInputStyle = styles.match(/\.credential-secret-field input\s*\{[\s\S]*?\n\}/)?.[0] || "";
if (!secretInputStyle.includes("box-sizing: border-box")) {
  throw new Error("credential-secret-field input should use border-box sizing.");
}

const credentialSelectStyle =
  styles.match(/\.credential-field \.settings-select\.app-select\s*\{[\s\S]*?\n\}/)?.[0] || "";
if (!credentialSelectStyle.includes("min-width: 0")) {
  throw new Error("credential form selects should override the global select min-width.");
}

const privateKeyPickerStyle =
  styles.match(/\.settings-path-picker\.credential-private-key-picker\s*\{[\s\S]*?\n\}/)?.[0] ||
  "";
if (!privateKeyPickerStyle.includes("grid-template-columns: minmax(0, 1fr) auto")) {
  throw new Error("private-key picker should keep the path input and choose button inside the form width.");
}

console.log("Credential account source check passed.");
