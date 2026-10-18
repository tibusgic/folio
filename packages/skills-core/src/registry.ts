import { SkillError } from './errors.ts';
import { toManifest, type Skill, type SkillManifest, type UiMode } from './types.ts';

const ID_PATTERN = /^[a-z]+(\.[a-z0-9-]+)+$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export class SkillRegistry {
  readonly #skills = new Map<string, Skill<any>>();

  register(skill: Skill<any>): this {
    if (!ID_PATTERN.test(skill.id)) {
      throw new SkillError('SKILL_FAILED', `Identifiant de skill invalide : ${skill.id}`);
    }
    if (!SEMVER.test(skill.version)) {
      throw new SkillError('SKILL_FAILED', `Version invalide pour ${skill.id} : ${skill.version}`);
    }
    if (this.#skills.has(skill.id)) {
      throw new SkillError('DUPLICATE_SKILL', `Skill déjà enregistrée : ${skill.id}`);
    }
    if (skill.input.minFiles < 0 || skill.input.maxFiles < skill.input.minFiles) {
      throw new SkillError('SKILL_FAILED', `Spécification d'entrée incohérente pour ${skill.id}`);
    }
    this.#skills.set(skill.id, skill);
    return this;
  }

  registerAll(skills: readonly Skill<any>[]): this {
    for (const s of skills) this.register(s);
    return this;
  }

  has(id: string): boolean {
    return this.#skills.has(id);
  }

  get(id: string): Skill<any> {
    const skill = this.#skills.get(id);
    if (!skill) throw new SkillError('UNKNOWN_SKILL', `Skill inconnue : ${id}`);
    return skill;
  }

  list(filter?: { mode?: UiMode }): Skill<any>[] {
    const all = [...this.#skills.values()];
    return filter?.mode ? all.filter((s) => s.modes.includes(filter.mode!)) : all;
  }

  manifests(filter?: { mode?: UiMode }): SkillManifest[] {
    return this.list(filter).map(toManifest);
  }
}
