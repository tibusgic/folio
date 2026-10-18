import { z } from 'zod';
import { defineSkill, MIME, SkillError, stem } from '@folio/skills-core';
import { callRemoteSkill, MB } from './transport.ts';

/**
 * Enterprise AES-256 encryption with distinct user/owner passwords
 * and granular permissions (printing, copying/extraction, modification, annotations).
 */
export const encryptSkill = defineSkill({
  id: 'pdf.encrypt',
  version: '2.0.0',
  title: 'Chiffrement AES-256',
  summary: 'Chiffrement cryptographique AES-256 (PDF 2.0 / R6) avec contrôle granulaire des droits (impression, copie, modification).',
  category: 'secure',
  execution: 'remote-ephemeral',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: {
    mimes: [MIME.pdf],
    minFiles: 1,
    maxFiles: 1,
    maxBytesPerFile: 200 * MB,
  },
  options: z.object({
    userPassword: z.string().min(4, 'Le mot de passe de lecture doit comporter au moins 4 caractères').max(128),
    ownerPassword: z.string().max(128).default(''),
    printPermission: z.enum(['full', 'low', 'none']).default('full'),
    allowCopy: z.boolean().default(false),
    allowModify: z.boolean().default(false),
    allowAnnotate: z.boolean().default(true),
    encryptMetadata: z.boolean().default(true),
  }),
  fields: [
    {
      kind: 'password',
      key: 'userPassword',
      label: 'Mot de passe d’ouverture (lecteur)',
      autocomplete: 'new-password',
      help: 'Exigé à chaque ouverture du document.',
    },
    {
      kind: 'password',
      key: 'ownerPassword',
      label: 'Mot de passe propriétaire (maître)',
      autocomplete: 'new-password',
      advanced: true,
      help: 'Verrouille les restrictions de droits. Généré aléatoirement si laissé vide.',
    },
    {
      kind: 'select',
      key: 'printPermission',
      label: 'Droit d’impression',
      options: [
        { value: 'full', label: 'Haute résolution autorisée' },
        { value: 'low', label: 'Basse résolution (150 DPI max)' },
        { value: 'none', label: 'Impression interdite' },
      ],
    },
    { kind: 'toggle', key: 'allowCopy', label: 'Autoriser la copie de texte / extraction' },
    { kind: 'toggle', key: 'allowModify', label: 'Autoriser l’assemblage et la modification', advanced: true },
    { kind: 'toggle', key: 'allowAnnotate', label: 'Autoriser les annotations et formulaires', advanced: true },
    { kind: 'toggle', key: 'encryptMetadata', label: 'Chiffrer les métadonnées XMP', advanced: true },
  ],
  async run(files, o, ctx) {
    const file = files[0]!;
    if (!o.userPassword.trim()) {
      throw new SkillError('INVALID_OPTIONS', 'Le mot de passe d’ouverture est obligatoire.');
    }
    return callRemoteSkill({
      endpoint: '/encrypt',
      files,
      options: o,
      ctx,
      fallbackFilename: `${stem(file.name)}-aes256.pdf`,
    });
  },
});

export const unlockSkill = defineSkill({
  id: 'pdf.unlock',
  version: '2.0.0',
  title: 'Déverrouillage PDF',
  summary: 'Retirer le chiffrement d’un PDF dont vous connaissez le mot de passe.',
  category: 'secure',
  execution: 'remote-ephemeral',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: {
    mimes: [MIME.pdf],
    minFiles: 1,
    maxFiles: 1,
    maxBytesPerFile: 200 * MB,
  },
  options: z.object({
    password: z.string().min(1, 'Mot de passe requis').max(128),
  }),
  fields: [
    {
      kind: 'password',
      key: 'password',
      label: 'Mot de passe actuel',
      autocomplete: 'current-password',
    },
  ],
  async run(files, o, ctx) {
    const file = files[0]!;
    return callRemoteSkill({
      endpoint: '/unlock',
      files,
      options: o,
      ctx,
      fallbackFilename: `${stem(file.name)}-deverrouille.pdf`,
    });
  },
});
