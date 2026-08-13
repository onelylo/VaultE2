import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactionPicker } from '../components/ReactionPicker';

describe('ReactionPicker', () => {
  it('renders the smiley button', () => {
    render(<ReactionPicker onSelect={vi.fn()} />);
    expect(screen.getByTitle('Add reaction')).toBeInTheDocument();
  });

  it('shows emoji picker on click', () => {
    render(<ReactionPicker onSelect={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Add reaction'));
    expect(screen.getByText('👍')).toBeInTheDocument();
    expect(screen.getByText('❤️')).toBeInTheDocument();
    expect(screen.getByText('🔥')).toBeInTheDocument();
  });

  it('calls onSelect when an emoji is clicked', () => {
    const onSelect = vi.fn();
    render(<ReactionPicker onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('Add reaction'));
    fireEvent.click(screen.getByText('👍'));
    expect(onSelect).toHaveBeenCalledWith('👍');
  });

  it('closes picker after selecting', () => {
    const onSelect = vi.fn();
    render(<ReactionPicker onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('Add reaction'));
    fireEvent.click(screen.getByText('👍'));
    expect(screen.queryByText('❤️')).not.toBeInTheDocument();
  });

  it('highlights existing emojis', () => {
    render(<ReactionPicker onSelect={vi.fn()} existingEmojis={['👍']} />);
    fireEvent.click(screen.getByTitle('Add reaction'));
    const thumbsUp = screen.getByText('👍');
    expect(thumbsUp.parentElement).toHaveStyle({ opacity: 1 });
  });
});
