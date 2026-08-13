import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageInput } from '../components/MessageInput';

describe('MessageInput', () => {
  const defaultProps = {
    onSendMessage: vi.fn(),
    onSendFiles: vi.fn(),
    disabled: false,
  };

  it('renders with placeholder text when enabled', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByPlaceholderText('Type a message…')).toBeInTheDocument();
  });

  it('renders disabled placeholder when disabled', () => {
    render(<MessageInput {...defaultProps} disabled={true} />);
    expect(screen.getByPlaceholderText('Select a conversation to start messaging…')).toBeInTheDocument();
  });

  it('calls onSendMessage when text is submitted', () => {
    const onSendMessage = vi.fn();
    render(<MessageInput {...defaultProps} onSendMessage={onSendMessage} />);
    const textarea = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSendMessage).toHaveBeenCalledWith('Hello world');
  });

  it('does not send empty messages', () => {
    const onSendMessage = vi.fn();
    render(<MessageInput {...defaultProps} onSendMessage={onSendMessage} />);
    const textarea = screen.getByPlaceholderText('Type a message…');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('allows shift+enter for new lines without sending', () => {
    const onSendMessage = vi.fn();
    render(<MessageInput {...defaultProps} onSendMessage={onSendMessage} />);
    const textarea = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(textarea, { target: { value: 'Line 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('renders announcement channel lock message for MEMBER role', () => {
    render(<MessageInput {...defaultProps} isAnnouncementChannel={true} userRole="MEMBER" />);
    expect(screen.getByText(/Only Admins and Supervisors can post/)).toBeInTheDocument();
  });

  it('allows ADMIN to type in announcement channels', () => {
    render(<MessageInput {...defaultProps} isAnnouncementChannel={true} userRole="ADMIN" />);
    expect(screen.getByPlaceholderText('Type a message…')).toBeInTheDocument();
  });

  it('shows file attach button', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByTitle('Attach file(s)')).toBeInTheDocument();
  });
});
