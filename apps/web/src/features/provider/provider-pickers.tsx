import type { RegionListResponse, SkillListResponse } from '@ogs/contracts';
import { useId, useState } from 'react';
import {
  EXPERIENCE_LABELS,
  WEEKDAYS,
  type ExperienceBand,
  type HoursEntry,
  type SkillChoice,
} from './provider-data';

type Skill = SkillListResponse['skills'][number];
type Region = RegionListResponse['regions'][number];

/**
 * Skills with an experience band each (Phase 5 plan §2.3). Only active skills
 * can be picked; a skill retired after the provider chose it stays listed so
 * saving never drops it silently.
 */
export function SkillPicker({
  skills,
  value,
  onChange,
  disabled = false,
}: {
  skills: readonly Skill[];
  value: readonly SkillChoice[];
  onChange: (next: SkillChoice[]) => void;
  disabled?: boolean;
}) {
  const chosen = new Map(value.map((choice) => [choice.code, choice.experience]));
  const categories = [...new Set(skills.map((skill) => skill.category))].sort();
  const retired = value.filter((choice) => !skills.some((skill) => skill.code === choice.code));

  const toggle = (code: string, on: boolean) => {
    onChange(
      on
        ? [...value, { code, experience: 'YEARS_1_3' }]
        : value.filter((choice) => choice.code !== code),
    );
  };
  const setExperience = (code: string, experience: ExperienceBand) => {
    onChange(value.map((choice) => (choice.code === code ? { code, experience } : choice)));
  };

  return (
    <div className="space-y-4">
      {categories.map((category) => (
        <fieldset key={category} className="space-y-2">
          <legend className="text-sm font-medium">{category}</legend>
          {skills
            .filter((skill) => skill.category === category)
            .map((skill) => (
              <SkillRow
                key={skill.code}
                label={skill.name}
                experience={chosen.get(skill.code)}
                disabled={disabled}
                onToggle={(on) => {
                  toggle(skill.code, on);
                }}
                onExperience={(experience) => {
                  setExperience(skill.code, experience);
                }}
              />
            ))}
        </fieldset>
      ))}
      {retired.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">No longer offered by OGS</legend>
          {retired.map((choice) => (
            <SkillRow
              key={choice.code}
              label={choice.code}
              experience={choice.experience}
              disabled={disabled}
              onToggle={(on) => {
                toggle(choice.code, on);
              }}
              onExperience={(experience) => {
                setExperience(choice.code, experience);
              }}
            />
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

function SkillRow({
  label,
  experience,
  disabled,
  onToggle,
  onExperience,
}: {
  label: string;
  experience: ExperienceBand | undefined;
  disabled: boolean;
  onToggle: (on: boolean) => void;
  onExperience: (experience: ExperienceBand) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label htmlFor={id} className="flex min-w-64 items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={experience !== undefined}
          disabled={disabled}
          onChange={(event) => {
            onToggle(event.target.checked);
          }}
        />
        {label}
      </label>
      {experience === undefined ? null : (
        <select
          aria-label={`Experience in ${label}`}
          value={experience}
          disabled={disabled}
          onChange={(event) => {
            onExperience(event.target.value as ExperienceBand);
          }}
          className="min-h-11 md:min-h-8 rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
        >
          {Object.entries(EXPERIENCE_LABELS).map(([band, text]) => (
            <option key={band} value={band}>
              {text}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Counties covered (Kenya's 47 counties, ISO 3166-2:KE), with a filter box. */
export function RegionPicker({
  regions,
  value,
  onChange,
  disabled = false,
}: {
  regions: readonly Region[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const filterId = useId();
  const [filter, setFilter] = useState('');
  const chosen = new Set(value);
  const visible = regions.filter((region) =>
    region.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={filterId} className="text-sm font-medium">
          Find a county
        </label>
        <input
          id={filterId}
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
          }}
          className="min-h-11 md:min-h-9 rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
        />
        <span className="text-sm text-muted-foreground">{value.length} selected</span>
      </div>
      <fieldset className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
        <legend className="sr-only">Counties covered</legend>
        {visible.map((region) => (
          <label key={region.code} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={chosen.has(region.code)}
              disabled={disabled}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...value, region.code]
                    : value.filter((code) => code !== region.code),
                );
              }}
            />
            {region.name}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/**
 * Weekly working hours, one range per day, in Nairobi time. An end of 00:00
 * means midnight (the API's 24:00).
 */
export function AvailabilityEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly HoursEntry[];
  onChange: (next: HoursEntry[]) => void;
  disabled?: boolean;
}) {
  const byDay = new Map(value.map((entry) => [entry.weekday, entry]));
  const update = (weekday: number, entry: HoursEntry | undefined) => {
    const others = value.filter((item) => item.weekday !== weekday);
    onChange(
      (entry === undefined ? others : [...others, entry]).sort((a, b) => a.weekday - b.weekday),
    );
  };
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Weekly working hours</legend>
      {WEEKDAYS.map((day, index) => {
        const weekday = index + 1;
        const entry = byDay.get(weekday);
        return (
          <div key={day} className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex w-32 items-center gap-2">
              <input
                type="checkbox"
                checked={entry !== undefined}
                disabled={disabled}
                onChange={(event) => {
                  update(
                    weekday,
                    event.target.checked ? { weekday, start: '08:00', end: '17:00' } : undefined,
                  );
                }}
              />
              {day}
            </label>
            {entry === undefined ? (
              <span className="text-muted-foreground">Not working</span>
            ) : (
              <>
                <input
                  type="time"
                  aria-label={`${day} start`}
                  value={entry.start}
                  disabled={disabled}
                  onChange={(event) => {
                    update(weekday, { ...entry, start: event.target.value });
                  }}
                  className="min-h-11 md:min-h-8 rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
                />
                <span aria-hidden="true">–</span>
                <input
                  type="time"
                  aria-label={`${day} end`}
                  value={entry.end === '24:00' ? '00:00' : entry.end}
                  disabled={disabled}
                  onChange={(event) => {
                    const end = event.target.value === '00:00' ? '24:00' : event.target.value;
                    update(weekday, { ...entry, end });
                  }}
                  className="min-h-11 md:min-h-8 rounded-md border border-control-border bg-surface px-3 text-base text-ink hover:border-ink md:text-sm"
                />
                {entry.start >= entry.end ? (
                  <span className="text-danger">End must be after start</span>
                ) : null}
              </>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
