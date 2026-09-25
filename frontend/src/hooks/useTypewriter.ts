import { useState, useEffect } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * Types each message, pauses, deletes it and moves to the next, forever.
 * Under reduced motion it returns the first message in full and never animates.
 */
const useTypewriter = (messages: string[]) => {
  const reducedMotion = useReducedMotion();
  const [text, setText] = useState('');
  const [messageIndex, setMessageIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (reducedMotion) return;
    const currentMessage = messages[messageIndex];

    const type = () => {
      if (isPaused) {
        setIsPaused(false);
        setIsDeleting(true);
        return;
      }

      if (isDeleting) {
        setText(currentMessage.substring(0, charIndex - 1));
        setCharIndex(charIndex - 1);
        if (charIndex - 1 === 0) {
          setIsDeleting(false);
          setMessageIndex((prev) => (prev + 1) % messages.length);
        }
      } else {
        setText(currentMessage.substring(0, charIndex + 1));
        setCharIndex(charIndex + 1);
        if (charIndex + 1 === currentMessage.length) {
          setIsPaused(true);
        }
      }
    };

    const timeout = setTimeout(type, isPaused ? 2000 : isDeleting ? 50 : 100);
    return () => clearTimeout(timeout);
  }, [reducedMotion, text, isDeleting, isPaused, charIndex, messageIndex, messages]);

  return reducedMotion ? messages[0] ?? '' : text;
};

export default useTypewriter;
