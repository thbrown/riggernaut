import './PhaseNav.css';

interface PhaseNavProps {
  onBack: () => void;
  onNext: () => void;
  backLabel?: string;
  nextLabel: string;
  nextDisabled?: boolean;
  nextTitle?: string;
}

export function PhaseNav({ onBack, onNext, backLabel = 'Back', nextLabel, nextDisabled, nextTitle }: PhaseNavProps) {
  return (
    <div className="phase-nav">
      <button className="phase-nav__btn" onClick={onBack}>{backLabel}</button>
      <button
        className="phase-nav__btn phase-nav__btn--primary"
        onClick={onNext}
        disabled={nextDisabled}
        title={nextTitle}
      >
        {nextLabel}
      </button>
    </div>
  );
}
