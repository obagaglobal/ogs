import { jobStatusSchema, areaOf, CUSTOMER_JOB_LABEL } from '@ogs/contracts';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../common/domain-error.js';
import { firstNameOf, initialsOf } from './job-support.js';
import { technicianFirstName } from './job-views.js';
import { allows, eventKind, isFinal, JOB_COMMANDS, requireJobCommand } from './transitions.js';

const STATES = jobStatusSchema.options;

describe('the job transition table (Phase 9 plan §2.4)', () => {
  it('lists only real states and never leaves a final state', () => {
    for (const [command, transition] of Object.entries(JOB_COMMANDS)) {
      for (const from of transition.from) {
        expect(STATES, command).toContain(from);
        expect(isFinal(from), `${command} from ${from}`).toBe(false);
      }
      if (transition.to !== null) {
        expect(STATES, command).toContain(transition.to);
      }
    }
  });

  it('requireJobCommand accepts listed states and refuses the rest with 409', () => {
    for (const [command, transition] of Object.entries(JOB_COMMANDS)) {
      for (const state of STATES) {
        const name = command as keyof typeof JOB_COMMANDS;
        if ((transition.from as readonly string[]).includes(state)) {
          expect(requireJobCommand(name, state).to).toBe(transition.to);
          expect(allows(name, state)).toBe(true);
        } else {
          expect(allows(name, state)).toBe(false);
          try {
            requireJobCommand(name, state);
            expect.unreachable(`${command} from ${state}`);
          } catch (error) {
            expect(error).toBeInstanceOf(DomainError);
            expect((error as DomainError).status).toBe(409);
          }
        }
      }
    }
  });

  it('provider-visible rows exist only for commands of the assignee side', () => {
    for (const [command, transition] of Object.entries(JOB_COMMANDS)) {
      if (
        ['offer', 'withdraw', 'decline', 'expire', 'editBrief', 'reassign', 'cancel'].includes(
          command,
        )
      ) {
        expect(transition.providerVisible, command).toBe(false);
      }
    }
  });

  it('a decline, a reason or an internal edit is never shown to customers', () => {
    expect(JOB_COMMANDS.decline.customerVisible).toBe(false);
    expect(JOB_COMMANDS.editBrief.customerVisible).toBe(false);
    expect(JOB_COMMANDS.workNote.customerVisible).toBe(false);
    expect(JOB_COMMANDS.offer.customerVisible).toBe(false);
  });

  it('every state has a customer label; event kinds are snake case', () => {
    for (const state of STATES) {
      expect(CUSTOMER_JOB_LABEL[state]).toBeDefined();
    }
    expect(eventKind('onTheWay')).toBe('on_the_way');
    expect(eventKind('submitReport')).toBe('submit_report');
  });
});

describe('names and areas shown to the other side (plan §2.5)', () => {
  it('a provider sees the area: the address up to the first comma', () => {
    expect(areaOf('Moi Avenue 12, Nairobi CBD, 3rd floor')).toBe('Moi Avenue 12');
    expect(areaOf('Westlands')).toBe('Westlands');
  });

  it('a customer sees a first name only (P9-8)', () => {
    expect(firstNameOf('amina.otieno@example.test')).toBe('Amina');
    expect(firstNameOf('j7@example.test')).toBeNull();
    expect(technicianFirstName('INDIVIDUAL', 'x@example.test', 'Kamau Tech Services')).toBe(
      'Kamau',
    );
    expect(technicianFirstName('COMPANY', 'brian_ochieng@example.test', 'Ignored Ltd')).toBe(
      'Brian',
    );
    expect(initialsOf('Amina')).toBe('AM');
    expect(initialsOf(null)).toBe('T');
  });
});
