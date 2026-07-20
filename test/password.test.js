const assert = require("assert");
const {
  validatePasswordStrength,
  validateUsername,
  generateOfficePassword,
} = require("../src/utils/password");

assert.strictEqual(validatePasswordStrength("short").ok, false);
assert.strictEqual(validatePasswordStrength("admin123").ok, false);
assert.strictEqual(validatePasswordStrength("onlyletters").ok, false);
assert.strictEqual(validatePasswordStrength("GoodPass12").ok, true);

assert.strictEqual(validateUsername("ab").ok, false);
assert.strictEqual(validateUsername("bad name").ok, false);
assert.strictEqual(validateUsername("office_1").ok, true);

const generated = generateOfficePassword();
assert.ok(generated.length >= 12);
assert.strictEqual(validatePasswordStrength(generated).ok, true);

console.log("✓ password utility tests passed");
