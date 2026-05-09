const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo / RN şablonu bazen MainActivity/MainApplication içindeki `package` satırını
 * android.package ile eşleştirmiyor; BuildConfig Gradle namespace'inde üretildiği için
 * Kotlin derlemesi "Unresolved reference BuildConfig" veriyor.
 */
function withAndroidKotlinPackage(config) {
  const pkg = config.android?.package;
  if (!pkg) return config;

  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const javaRoot = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java');
      if (!fs.existsSync(javaRoot)) return cfg;

      const fixFile = (filePath) => {
        let content = fs.readFileSync(filePath, 'utf8');
        const next = content.replace(/^package\s+[\w.]+\s*$/m, `package ${pkg}`);
        if (next !== content) fs.writeFileSync(filePath, next);
      };

      const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full);
          else if (ent.name === 'MainActivity.kt' || ent.name === 'MainApplication.kt') fixFile(full);
        }
      };

      walk(javaRoot);
      return cfg;
    },
  ]);
}

module.exports = withAndroidKotlinPackage;
