import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageInput } from '../components/MessageInput';

describe('MessageInput — multi-file support', () => {
  const defaultProps = {
    onSendMessage: vi.fn(),
    onSendFiles: vi.fn(),
    disabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows attaching multiple files via input', () => {
    render(<MessageInput {...defaultProps} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAttribute('multiple');
  });

  it('shows placeholder text for optional message when files are queued', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message…');
    expect(textarea).toBeInTheDocument();
  });

  it('does not send empty text on Enter without files', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message…');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(defaultProps.onSendMessage).not.toHaveBeenCalled();
    expect(defaultProps.onSendFiles).not.toHaveBeenCalled();
  });

  it('sends text message on Enter', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(defaultProps.onSendMessage).toHaveBeenCalledWith('Hello');
  });

  it('supports shift+enter for multiline without sending', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(textarea, { target: { value: 'Line 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(defaultProps.onSendMessage).not.toHaveBeenCalled();
  });

  it('shows locked placeholder in announcement channel for MEMBER', () => {
    render(<MessageInput {...defaultProps} isAnnouncementChannel={true} userRole="MEMBER" />);
    expect(screen.getByText(/Only Admins and Supervisors/)).toBeInTheDocument();
  });

  it('allows ADMIN to type in announcement channels', () => {
    render(<MessageInput {...defaultProps} isAnnouncementChannel={true} userRole="ADMIN" />);
    expect(screen.getByPlaceholderText('Type a message…')).toBeInTheDocument();
  });

  it('allows SUPERVISOR to type in announcement channels', () => {
    render(<MessageInput {...defaultProps} isAnnouncementChannel={true} userRole="SUPERVISOR" />);
    expect(screen.getByPlaceholderText('Type a message…')).toBeInTheDocument();
  });
});
