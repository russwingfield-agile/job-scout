import type { SearchProfile } from '@job-scout/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TagInput } from '../src/components/ui/TagInput.js';
import { validateCvFile } from '../src/features/cvs/CvUploader.js';
import { ProfileForm } from '../src/features/cvs/ProfileForm.js';

function ControlledTags({ initial = [] as string[] }) {
  const [values, setValues] = useState(initial);
  return <TagInput label="Job titles" values={values} onChange={setValues} />;
}

describe('TagInput', () => {
  it('adds a trimmed tag on Enter and on comma, and clears the field', async () => {
    const user = userEvent.setup();
    render(<ControlledTags />);
    const field = screen.getByLabelText('Job titles');

    await user.type(field, '  Agile Coach {Enter}');
    await user.type(field, 'Scrum Master,');
    expect(screen.getByText('Agile Coach')).toBeInTheDocument();
    expect(screen.getByText('Scrum Master')).toBeInTheDocument();
    expect(field).toHaveValue('');
  });

  it('ignores blanks and case-insensitive duplicates', async () => {
    const user = userEvent.setup();
    render(<ControlledTags initial={['Agile Coach']} />);
    const field = screen.getByLabelText('Job titles');

    await user.type(field, '   {Enter}');
    await user.type(field, 'agile coach{Enter}');
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(1);
  });

  it('removes a tag with its button, and the last tag with Backspace on an empty field', async () => {
    const user = userEvent.setup();
    render(<ControlledTags initial={['A', 'B', 'C']} />);

    await user.click(screen.getByRole('button', { name: 'Remove B' }));
    expect(screen.queryByText('B')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Job titles'));
    await user.keyboard('{Backspace}');
    expect(screen.queryByText('C')).not.toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('keeps a half-typed value when the field loses focus', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ControlledTags />
        <button type="button">elsewhere</button>
      </>,
    );
    await user.type(screen.getByLabelText('Job titles'), 'PMO Lead');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.getByText('PMO Lead')).toBeInTheDocument();
  });

  it('shows an error message with role=alert and links hints/errors to the input', () => {
    render(
      <TagInput
        label="Locations"
        values={[]}
        onChange={() => {}}
        error="Add at least one"
        hint="hint"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one');
    expect(screen.getByLabelText('Locations')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('hint')).not.toBeInTheDocument();
  });
});

const profile: SearchProfile = {
  id: 'p1',
  cvId: 'cv1',
  jobTitles: ['Agile Coach'],
  mustKeywords: [],
  excludeKeywords: [],
  locations: ['London', 'Remote'],
  radiusMiles: 25,
  employmentTypes: ['contract', 'permanent'],
  minDayRate: null,
  minSalary: null,
  ir35Preference: 'any',
  workModes: [],
  maxOnsiteDays: null,
  active: true,
  updatedAt: '2026-11-20T09:00:00.000Z',
};

describe('ProfileForm', () => {
  it('shows the current profile', () => {
    render(<ProfileForm profile={profile} onSave={() => {}} />);
    expect(screen.getByText('Agile Coach')).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByLabelText('Search radius (miles)')).toHaveValue('25');
    expect(screen.getByLabelText('Contract')).toBeChecked();
    expect(screen.getByLabelText('Temp')).not.toBeChecked();
    expect(screen.getByLabelText('Any')).toBeChecked();
    expect(screen.getByLabelText('Include this profile in searches')).toBeChecked();
  });

  it('refuses to save without a job title and says why', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileForm profile={profile} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Remove Agile Coach' }));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(onSave).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Job titles')).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses to save with no employment type selected', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileForm profile={profile} onSave={onSave} />);

    await user.click(screen.getByLabelText('Contract'));
    await user.click(screen.getByLabelText('Permanent'));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(onSave).not.toHaveBeenCalled();
    const group = screen.getByRole('group', { name: 'Employment types' });
    expect(within(group).getByRole('alert')).toBeInTheDocument();
  });

  it('refuses a non-numeric day rate and a negative salary', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileForm profile={profile} onSave={onSave} />);

    await user.type(screen.getByLabelText('Minimum day rate (£)'), 'lots');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Minimum day rate (£)')).toHaveAttribute('aria-invalid', 'true');

    await user.clear(screen.getByLabelText('Minimum day rate (£)'));
    await user.type(screen.getByLabelText('Minimum salary (£)'), '-5');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Minimum salary (£)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('saves parsed values: numbers as numbers, blanks as null, choices as chosen', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileForm profile={profile} onSave={onSave} />);

    await user.type(screen.getByLabelText('Job titles'), 'Delivery Lead{Enter}');
    await user.type(screen.getByLabelText('Exclude keywords'), 'graduate{Enter}');
    await user.clear(screen.getByLabelText('Search radius (miles)'));
    await user.type(screen.getByLabelText('Search radius (miles)'), '10');
    await user.type(screen.getByLabelText('Minimum day rate (£)'), '550');
    await user.click(screen.getByLabelText('Outside only'));
    await user.click(screen.getByLabelText('Permanent'));
    await user.click(screen.getByLabelText('Remote'));
    await user.click(screen.getByLabelText('Hybrid'));
    await user.type(screen.getByLabelText('Max days on site per week'), '2');
    await user.click(screen.getByLabelText('Include this profile in searches'));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      jobTitles: ['Agile Coach', 'Delivery Lead'],
      mustKeywords: [],
      excludeKeywords: ['graduate'],
      locations: ['London', 'Remote'],
      radiusMiles: 10,
      employmentTypes: ['contract'],
      minDayRate: 550,
      minSalary: null,
      ir35Preference: 'outside_only',
      workModes: ['remote', 'hybrid'],
      maxOnsiteDays: 2,
      active: false,
    });
  });

  it('clears an earlier error once the form is valid again', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileForm profile={profile} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Remove Agile Coach' }));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText('Job titles'), 'Scrum Master{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows a busy state while saving', () => {
    render(<ProfileForm profile={profile} onSave={() => {}} saving />);
    expect(screen.getByRole('button', { name: /Save profile/ })).toBeDisabled();
  });
});

describe('validateCvFile', () => {
  const MB5 = 5 * 1024 * 1024;
  const file = (name: string, type: string, size: number) =>
    new File([new Uint8Array(size)], name, { type });

  it('accepts PDF and DOCX by type or extension', () => {
    expect(validateCvFile(file('cv.pdf', 'application/pdf', 10), MB5)).toBeNull();
    expect(
      validateCvFile(
        file(
          'cv.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          10,
        ),
        MB5,
      ),
    ).toBeNull();
    // Some browsers send no type for DOCX; the extension then decides.
    expect(validateCvFile(file('CV.DOCX', '', 10), MB5)).toBeNull();
  });

  it.each([
    ['an empty file', file('cv.pdf', 'application/pdf', 0), 'empty'],
    ['an oversized file', file('cv.pdf', 'application/pdf', MB5 + 1), 'larger than 5 MB'],
    ['an image', file('cv.png', 'image/png', 10), 'Only PDF and DOCX'],
    ['a legacy .doc', file('cv.doc', 'application/msword', 10), 'Only PDF and DOCX'],
  ])('rejects %s', (_label, f, message) => {
    expect(validateCvFile(f, MB5)).toContain(message);
  });
});
