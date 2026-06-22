#!/usr/bin/env bash
# check-skills.sh — validate that skills work on both Pi and Claude Code.
#
# Checks:
#   1. Every skills/<name>/SKILL.md has YAML frontmatter with non-empty
#      `name` and `description`.
#   2. `.claude/skills` symlink exists and points to `../skills`.
#   3. `CLAUDE.md` symlink exists and points to `AGENTS.md`.
#   4. `.claude/skills/` resolves to the same entries as `skills/` (symlink works).
#
# Exit non-zero on any failure. Designed for pre-commit and CI.
# Pure bash + standard utils (find, readlink, grep). No Python/YAML deps.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

failures=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() {
	printf '  \033[31m✗\033[0m %s\n' "$1"
	failures=$((failures + 1))
}
info() { printf '    %s\n' "$1"; }

echo "Checking skills (Pi + Claude Code compatibility)"
echo "------------------------------------------------"

# --- 1. Validate every SKILL.md frontmatter ----------------------------------
skills_dir="$ROOT/skills"
if [[ ! -d "$skills_dir" ]]; then
	fail "skills/ directory not found at $skills_dir"
else
	shopt -s nullglob
	skill_files=("$skills_dir"/*/SKILL.md)
	if [[ ${#skill_files[@]} -eq 0 ]]; then
		fail "no skills found under skills/*/SKILL.md"
	else
		for f in "${skill_files[@]}"; do
			name=$(basename "$(dirname "$f")")
			# Extract frontmatter block (between first two --- lines).
			fm=$(awk 'NR==1 && /^---[[:space:]]*$/ {p=1; next} p && /^---[[:space:]]*$/ {exit} p' "$f")
			if [[ -z "$fm" ]]; then
				fail "skills/$name/SKILL.md: missing or empty YAML frontmatter"
				continue
			fi
			skill_name=$(grep -E '^name:' <<<"$fm" | head -1 | sed -E 's/^name:[[:space:]]*//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/')
			skill_desc=$(grep -E '^description:' <<<"$fm" | head -1 | sed -E 's/^description:[[:space:]]*//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/')
			if [[ -z "$skill_name" ]]; then
				fail "skills/$name/SKILL.md: missing 'name' in frontmatter"
			elif [[ "$skill_name" != "$name" ]]; then
				fail "skills/$name/SKILL.md: frontmatter name '$skill_name' != folder name '$name'"
			else
				pass "skills/$name/SKILL.md: name ok"
			fi
			if [[ -z "$skill_desc" ]]; then
				fail "skills/$name/SKILL.md: missing 'description' in frontmatter"
			elif [[ ! "$skill_desc" =~ [Uu]se\ when|when\ the ]]; then
				info "skills/$name: description lacks 'Use when …' (Claude auto-trigger hint)"
			fi
		done
	fi
fi

# --- 2. .claude/skills symlink -----------------------------------------------
claude_skills="$ROOT/.claude/skills"
if [[ -L "$claude_skills" ]]; then
	target=$(readlink "$claude_skills")
	if [[ "$target" == "../skills" ]]; then
		pass ".claude/skills -> ../skills (symlink ok)"
	else
		fail ".claude/skills symlink points to '$target', expected '../skills'"
	fi
	if [[ ! -d "$claude_skills/" ]]; then
		fail ".claude/skills symlink is broken (target missing)"
	fi
else
	fail ".claude/skills is not a symlink (expected -> ../skills)"
fi

# --- 3. CLAUDE.md symlink -----------------------------------------------------
claude_md="$ROOT/CLAUDE.md"
if [[ -L "$claude_md" ]]; then
	target=$(readlink "$claude_md")
	if [[ "$target" == "AGENTS.md" ]]; then
		pass "CLAUDE.md -> AGENTS.md (symlink ok)"
	else
		fail "CLAUDE.md symlink points to '$target', expected 'AGENTS.md'"
	fi
else
	fail "CLAUDE.md is not a symlink (expected -> AGENTS.md)"
fi

# --- 4. Symlink actually resolves to same skills -----------------------------
if [[ -d "$claude_skills/" && -d "$skills_dir" ]]; then
	via_claude=$(cd "$claude_skills" && find . -maxdepth 1 -mindepth 1 -type d | sort)
	via_canon=$(cd "$skills_dir" && find . -maxdepth 1 -mindepth 1 -type d | sort)
	if [[ "$via_claude" == "$via_canon" ]]; then
		pass "skills visible via .claude/skills match skills/ (sync ok)"
	else
		fail "skill set differs between skills/ and .claude/skills/"
		info "canonical:  $(echo "$via_canon" | tr '\n' ' ')"
		info "via claude: $(echo "$via_claude" | tr '\n' ' ')"
	fi
fi

echo "------------------------------------------------"
if [[ $failures -eq 0 ]]; then
	echo "All checks passed."
	exit 0
else
	echo "$failures check(s) failed."
	exit 1
fi
