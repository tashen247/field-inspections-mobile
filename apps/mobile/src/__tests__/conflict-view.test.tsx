import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConflictView } from '../features/conflict/ConflictView';
import { makeInspection } from './fakes';

const handlers = () => ({ onResubmit: jest.fn(), onDiscard: jest.fn(), onLater: jest.fn() });

describe('ConflictView', () => {
  it('offers to resend on the latest version when a manager edited the job', async () => {
    const h = handlers();
    await render(
      <ConflictView
        details={{ reason: 'modified', baseVersion: 1, current: makeInspection({ version: 3 }) }}
        localSummary="19 answers, 6 photos, client signature"
        {...h}
      />,
    );
    expect(screen.getByText('Your manager changed this job')).toBeTruthy();
    expect(screen.getByText(/version 3 \(you had 1\)/)).toBeTruthy();
    expect(screen.getByText('19 answers, 6 photos, client signature')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Send my work on the latest version'));
    expect(h.onResubmit).toHaveBeenCalled();
  });

  it('only allows discard when the job was reassigned, and says to whom', async () => {
    const h = handlers();
    await render(
      <ConflictView
        details={{
          reason: 'reassigned',
          baseVersion: 1,
          current: makeInspection({ version: 2, assigneeName: 'Pieter van Wyk' }),
        }}
        localSummary="3 answers"
        {...h}
      />,
    );
    expect(screen.getByText('This job was reassigned')).toBeTruthy();
    expect(screen.getByText('Assigned to Pieter van Wyk')).toBeTruthy();
    expect(screen.queryByLabelText('Send my work on the latest version')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Discard my work on this device'));
    await fireEvent.press(screen.getByLabelText('Decide later'));
    expect(h.onDiscard).toHaveBeenCalled();
    expect(h.onLater).toHaveBeenCalled();
  });

  it('explains a closed job', async () => {
    await render(
      <ConflictView
        details={{
          reason: 'closed',
          baseVersion: 2,
          current: makeInspection({ status: 'approved', version: 4 }),
        }}
        localSummary="x"
        {...handlers()}
      />,
    );
    expect(screen.getByText('This job is already closed')).toBeTruthy();
    expect(screen.getByText(/Approved · version 4/)).toBeTruthy();
  });
});
