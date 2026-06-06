#!/usr/bin/env node
/**
 * Git Hook: 每次提交时自动检测核心文件变化并更新 PROJECT_SPECIFICATION_PROFILE.json
 * 用法：在项目根目录运行 npm install 后自动安装
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROFILE_FILE = path.join(__dirname, '..', 'PROJECT_SPECIFICATION_PROFILE.json');
const CORE_PATTERNS = [
  'src/core/',
  'src/adapters/',
  'src/services/',
  'src/tools/',
  'src/app/',
  'package.json',
];

function getChangedFiles() {
  try {
    const output = execSync('git diff --name-only --cached', { encoding: 'utf8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function isCoreFileChanged(files) {
  return files.some(file => 
    CORE_PATTERNS.some(pattern => file.startsWith(pattern))
  );
}

function updateProfile() {
  try {
    const profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    const timestamp = new Date().toISOString();
    
    // 添加更新时间戳
    profile.last_updated = timestamp;
    profile.updated_by = 'git-hook';
    
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2) + '\n', 'utf8');
    
    // 自动 add 到 staging
    try {
      execSync(`git add "${PROFILE_FILE}"`);
      console.log('✅ [cyberboss] PROJECT_SPECIFICATION_PROFILE.json 已自动更新');
    } catch {
      console.warn('⚠️  [cyberboss] 无法自动 add 更新的 profile 文件，请手动添加');
    }
  } catch (error) {
    console.error(`❌ [cyberboss] 更新 profile 失败: ${error.message}`);
  }
}

function main() {
  const changedFiles = getChangedFiles();
  
  if (changedFiles.length === 0) {
    return;
  }
  
  if (!isCoreFileChanged(changedFiles)) {
    return;
  }
  
  console.log('[cyberboss] 检测到核心文件变化，正在更新 PROJECT_SPECIFICATION_PROFILE.json...');
  updateProfile();
}

main();
