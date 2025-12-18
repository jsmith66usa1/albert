import React, { useEffect, useState, useRef } from 'react';

interface TypewriterTextProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
  isStreaming?: boolean;
}

const TypewriterText: React.FC<TypewriterTextProps> = ({ text, speed = 10, onComplete, isStreaming }) => {
  const [displayedText, setDisplayedText] = useState('');
  const indexRef = useRef(0);
  const textRef = useRef(text);

  useEffect(() => {
    // If text changes abruptly (e.g. streaming update), update reference
    textRef.current = text;
    
    // If we are not streaming and the text length matches, we are done
    if (!isStreaming && displayedText.length === text.length) {
        if (onComplete) onComplete();
        return;
    }
  }, [text, isStreaming, displayedText.length, onComplete]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (indexRef.current < textRef.current.length) {
        setDisplayedText((prev) => prev + textRef.current.charAt(indexRef.current));
        indexRef.current += 1;
      } else {
        clearInterval(timer);
      }
    }, speed);

    return () => clearInterval(timer);
  }, [speed]);

  // For Markdown-like basic rendering (bold/italics) we would need a parser, 
  // but for this specific effect, we'll keep it simple text to avoid VDOM jumping during typing.
  // We handle newlines.
  return (
    <div className="whitespace-pre-wrap font-serif leading-relaxed text-stone-800">
      {displayedText}
    </div>
  );
};

export default TypewriterText;
