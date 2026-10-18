import { isFieldVisible, type FieldSpec, type Skill, type UiMode } from '@folio/skills-core';

export interface FormController {
  getValues(): Record<string, unknown>;
}

/** Extract default values from the skill's Zod schema by parsing an empty or minimal object. */
export function extractDefaultValues(skill: Skill<any>): Record<string, unknown> {
  const probe: Record<string, unknown> = {};
  for (const field of skill.fields) {
    if (field.kind === 'text' && field.key === 'text') probe[field.key] = 'CONFIDENTIEL';
    if (field.kind === 'text' && field.key === 'signerName') probe[field.key] = 'Directeur des Opérations';
    if (field.kind === 'password') probe[field.key] = '';
  }
  const parsed = skill.options.safeParse(probe);
  if (parsed.success && typeof parsed.data === 'object' && parsed.data !== null) {
    return { ...(parsed.data as Record<string, unknown>) };
  }
  return probe;
}

/**
 * Renders declarative `FieldSpec[]` into accessible DOM controls (Zero innerHTML injection
 * of user strings; includes interactive vector signature canvas pad).
 */
export function renderSkillForm(
  container: HTMLElement,
  skill: Skill<any>,
  mode: UiMode,
  initialValues?: Record<string, unknown>,
): FormController {
  const values: Record<string, unknown> = {
    ...extractDefaultValues(skill),
    ...(initialValues ?? {}),
  };

  function rebuild(): void {
    container.replaceChildren();

    const visibleFields = skill.fields.filter((f) => isFieldVisible(f, values, mode));
    if (visibleFields.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'field__help';
      empty.textContent =
        mode === 'quick'
          ? 'Réglages optimaux préconfigurés. Passez en mode « Entreprise » pour débloquer les contrôles avancés.'
          : 'Ce pipeline ne requiert aucun paramètre additionnel.';
      container.appendChild(empty);
      return;
    }

    for (const spec of visibleFields) {
      container.appendChild(createFieldElement(spec));
    }
  }

  function createFieldElement(spec: FieldSpec): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = spec.kind === 'toggle' ? 'field field--row' : 'field';
    const inputId = `field-${skill.id}-${spec.key}`;

    const label = document.createElement('label');
    label.className = 'field__label';
    label.htmlFor = inputId;

    const labelText = document.createElement('span');
    labelText.textContent = spec.label;
    label.appendChild(labelText);

    const unitBadge = document.createElement('span');
    unitBadge.className = 'field__unit';
    label.appendChild(unitBadge);

    wrapper.appendChild(label);

    switch (spec.kind) {
      case 'text':
      case 'pages':
      case 'password': {
        const input = document.createElement('input');
        input.id = inputId;
        input.className = spec.kind === 'pages' ? 'input input--mono' : 'input';
        input.type = spec.kind === 'password' ? 'password' : 'text';
        if (spec.kind !== 'password' && spec.placeholder) input.placeholder = spec.placeholder;
        if (spec.kind === 'text' && spec.maxLength) input.maxLength = spec.maxLength;
        if (spec.kind === 'password' && spec.autocomplete) input.autocomplete = spec.autocomplete;
        input.value = String(values[spec.key] ?? '');
        input.addEventListener('input', () => {
          values[spec.key] = input.value;
        });
        wrapper.appendChild(input);
        break;
      }

      case 'textarea': {
        const area = document.createElement('textarea');
        area.id = inputId;
        area.className = spec.mono ? 'textarea textarea--mono' : 'textarea';
        area.rows = spec.rows ?? 4;
        area.value = String(values[spec.key] ?? '');
        area.addEventListener('input', () => {
          values[spec.key] = area.value;
        });
        wrapper.appendChild(area);
        break;
      }

      case 'number':
      case 'range': {
        const input = document.createElement('input');
        input.id = inputId;
        input.className = 'input input--mono';
        input.type = spec.kind;
        input.min = String(spec.min);
        input.max = String(spec.max);
        if (spec.step !== undefined) input.step = String(spec.step);
        const cur = Number(values[spec.key] ?? spec.min);
        input.value = String(cur);
        const fmtUnit = (v: number) => `${v}${spec.unit ? ` ${spec.unit}` : ''}`;
        unitBadge.textContent = fmtUnit(cur);
        input.addEventListener('input', () => {
          const num = Number(input.value);
          values[spec.key] = num;
          unitBadge.textContent = fmtUnit(num);
        });
        wrapper.appendChild(input);
        break;
      }

      case 'select': {
        const select = document.createElement('select');
        select.id = inputId;
        select.className = 'select';
        for (const opt of spec.options) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          if (String(values[spec.key]) === opt.value) o.selected = true;
          select.appendChild(o);
        }
        select.addEventListener('change', () => {
          values[spec.key] = select.value;
          rebuild();
        });
        wrapper.appendChild(select);
        break;
      }

      case 'toggle': {
        const input = document.createElement('input');
        input.id = inputId;
        input.type = 'checkbox';
        input.checked = Boolean(values[spec.key]);
        input.addEventListener('change', () => {
          values[spec.key] = input.checked;
          rebuild();
        });
        wrapper.appendChild(input);
        break;
      }

      case 'color': {
        const input = document.createElement('input');
        input.id = inputId;
        input.type = 'color';
        input.className = 'input';
        input.style.height = '34px';
        input.style.padding = '2px';
        const cVal = String(values[spec.key] ?? '#B4532A');
        input.value = cVal;
        unitBadge.textContent = cVal.toUpperCase();
        input.addEventListener('input', () => {
          values[spec.key] = input.value;
          unitBadge.textContent = input.value.toUpperCase();
        });
        wrapper.appendChild(input);
        break;
      }

      case 'signature': {
        const padWrap = document.createElement('div');
        padWrap.className = 'signature-pad-wrap';
        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 100;
        canvas.className = 'signature-canvas';
        canvas.setAttribute('aria-label', 'Zone de tracé de signature manuscrite');

        const bar = document.createElement('div');
        bar.className = 'signature-pad-bar';
        const statusSpan = document.createElement('span');
        const strokes: [number, number][][] = Array.isArray(values[spec.key])
          ? (values[spec.key] as [number, number][][])
          : [];
        statusSpan.textContent = strokes.length ? `${strokes.length} trait(s)` : 'Tracé vectoriel libre';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn-link';
        clearBtn.textContent = 'Effacer';

        const ctx = canvas.getContext('2d')!;
        const redraw = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = '#d0532f';
          ctx.lineWidth = 1.8;
          ctx.lineCap = 'round';
          for (const s of strokes) {
            if (s.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(s[0]![0] * canvas.width, s[0]![1] * canvas.height);
            for (let i = 1; i < s.length; i++) {
              ctx.lineTo(s[i]![0] * canvas.width, s[i]![1] * canvas.height);
            }
            ctx.stroke();
          }
        };
        redraw();

        let drawing = false;
        let currentStroke: [number, number][] = [];

        const pointFromEvent = (e: PointerEvent): [number, number] => {
          const rect = canvas.getBoundingClientRect();
          const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
          const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / Math.max(1, rect.height)));
          return [Number(x.toFixed(4)), Number(y.toFixed(4))];
        };

        canvas.addEventListener('pointerdown', (e) => {
          drawing = true;
          canvas.setPointerCapture(e.pointerId);
          currentStroke = [pointFromEvent(e)];
          strokes.push(currentStroke);
          values[spec.key] = strokes;
        });

        canvas.addEventListener('pointermove', (e) => {
          if (!drawing) return;
          currentStroke.push(pointFromEvent(e));
          redraw();
        });

        const stopDrawing = () => {
          if (!drawing) return;
          drawing = false;
          statusSpan.textContent = `${strokes.length} trait(s) vectoriel(s)`;
        };
        canvas.addEventListener('pointerup', stopDrawing);
        canvas.addEventListener('pointercancel', stopDrawing);

        clearBtn.addEventListener('click', () => {
          strokes.length = 0;
          values[spec.key] = [];
          redraw();
          statusSpan.textContent = 'Tracé vectoriel libre';
        });

        bar.append(statusSpan, clearBtn);
        padWrap.append(canvas, bar);
        wrapper.appendChild(padWrap);
        break;
      }
    }

    if (spec.help) {
      const help = document.createElement('p');
      help.className = 'field__help';
      help.textContent = spec.help;
      wrapper.appendChild(help);
    }

    return wrapper;
  }

  rebuild();

  return {
    getValues: () => ({ ...values }),
  };
}
