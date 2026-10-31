

// skills.sh SKILL.md frontmatter
export interface SkillFrontmatter {
  readonly name: string
  readonly description: string
  readonly allowedTools?: string
  readonly userInvocable?: boolean
  readonly metadata?: Readonly<Record<string, unknown>>
}

// parsed SKILL.md file
export interface ParsedSkill {
  readonly frontmatter: SkillFrontmatter
  readonly body: string
}
