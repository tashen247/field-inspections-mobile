import { VEHICLE_TEMPLATE, templateBodySchema, validateChecklist } from '@fim/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChecklistRenderer } from '../features/checklist/ChecklistRenderer';

const small = templateBodySchema.parse({
  diagram: 'vehicle-top',
  requireSignature: false,
  sections: [
    {
      key: 'checks',
      title: 'Checks',
      items: [
        {
          key: 'lights',
          kind: 'passFail',
          label: 'Lights working',
          required: true,
          noteOnFail: true,
        },
        {
          key: 'tread',
          kind: 'number',
          label: 'Tread depth',
          unit: 'mm',
          min: 0,
          max: 20,
          required: true,
        },
        {
          key: 'glass',
          kind: 'select',
          label: 'Windscreen',
          options: [
            { value: 'intact', label: 'Intact' },
            { value: 'cracked', label: 'Cracked' },
          ],
        },
        {
          key: 'vin',
          kind: 'passFail',
          label: 'VIN matches',
          shots: [{ key: 'vin_plate', label: 'VIN plate', required: true }],
        },
      ],
    },
  ],
});

describe('ChecklistRenderer', () => {
  it('renders every section and item of a real template', async () => {
    await render(<ChecklistRenderer template={VEHICLE_TEMPLATE} answers={{}} photos={[]} />);
    for (const section of VEHICLE_TEMPLATE.sections)
      expect(screen.getByText(section.title)).toBeTruthy();
    expect(screen.getByTestId('item-odometer')).toBeTruthy();
    expect(screen.getByText(/0 of 17 answered/)).toBeTruthy();
  });

  it('reports pass/fail, select and number changes', async () => {
    const onChange = jest.fn();
    await render(
      <ChecklistRenderer template={small} answers={{}} photos={[]} onChange={onChange} />,
    );
    await fireEvent.press(screen.getAllByLabelText('Pass')[0]!);
    await fireEvent.press(screen.getByLabelText('Cracked'));
    const tread = screen.getByLabelText('Tread depth');
    await fireEvent.changeText(tread, '4,5');
    await fireEvent(tread, 'endEditing');
    expect(onChange.mock.calls).toEqual([
      ['lights', 'pass'],
      ['glass', 'cracked'],
      ['tread', 4.5],
    ]);
  });

  it('shows range errors while typing and asks for a note on fail', async () => {
    await render(
      <ChecklistRenderer
        template={small}
        answers={{ lights: { value: 'fail', note: null } }}
        photos={[]}
        onChange={jest.fn()}
      />,
    );
    await fireEvent.changeText(screen.getByLabelText('Tread depth'), '25');
    expect(screen.getByText('Tread depth must be at most 20')).toBeTruthy();
    expect(screen.getByLabelText('Note for Lights working')).toBeTruthy();
    expect(screen.getByPlaceholderText('Required: describe the problem')).toBeTruthy();
  });

  it('marks required guided shots and opens the camera for them', async () => {
    const onTakePhoto = jest.fn();
    await render(
      <ChecklistRenderer template={small} answers={{}} photos={[]} onTakePhoto={onTakePhoto} />,
    );
    await fireEvent.press(screen.getByLabelText('Take VIN plate photo, required'));
    expect(onTakePhoto).toHaveBeenCalledWith('vin', 'vin_plate');
  });

  it('shows required-field issues from the shared validator', async () => {
    const issues = validateChecklist(small, { answers: [], photos: [], hasSignature: false });
    await render(<ChecklistRenderer template={small} answers={{}} photos={[]} issues={issues} />);
    expect(screen.getByText('Lights working is required')).toBeTruthy();
    expect(screen.getByText('Tread depth is required')).toBeTruthy();
    expect(screen.getByText('Take the "VIN plate" photo')).toBeTruthy();
    expect(screen.queryByText(/Windscreen is required/)).toBeNull();
  });

  it('is read-only after submission', async () => {
    const onChange = jest.fn();
    await render(
      <ChecklistRenderer template={small} answers={{}} photos={[]} readOnly onChange={onChange} />,
    );
    await fireEvent.press(screen.getByLabelText('Cracked'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Take Add photo photo')).toBeNull();
  });
});
