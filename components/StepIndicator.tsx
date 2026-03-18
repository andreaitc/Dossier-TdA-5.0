
import React from 'react';
import { Step } from '../types';

interface StepIndicatorProps {
  currentStep: Step;
  onStepClick: (step: Step) => void;
}

const steps = [
  { id: Step.Selection, label: 'Inizio' },
  { id: Step.Setup, label: 'Copertina' },
  { id: Step.Style, label: 'Design' },
  { id: Step.Content, label: 'Input' },
  { id: Step.Editor, label: 'Revisione' },
  { id: Step.Preview, label: 'FINE' },
];

const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep, onStepClick }) => {
  const currentIndex = steps.findIndex(s => s.id === currentStep);
  
  return (
    <div className="flex items-center justify-between w-full max-w-4xl mx-auto px-1 md:px-4 gap-0.5 md:gap-2">
      {steps.map((step, index) => {
        const isActive = step.id === currentStep;
        const isPast = currentIndex > index;
        
        return (
          <React.Fragment key={step.id}>
            <button 
              onClick={() => onStepClick(step.id)}
              className="flex flex-col items-center relative shrink-0 group focus:outline-none"
            >
              <div className={`w-3.5 h-3.5 sm:w-4.5 sm:h-4.5 md:w-5.5 md:h-5.5 rounded-full flex items-center justify-center text-[7.5px] sm:text-[9.5px] font-black transition-all duration-300 group-hover:scale-110 ${
                isActive ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-100' : 
                isPast ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
              }`}>
                {isPast ? (
                  <svg className="w-2 sm:w-2.5 md:w-3 h-2 sm:h-2.5 md:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : index + 1}
              </div>
              <span className={`text-[6.5px] sm:text-[8.5px] md:text-[11px] mt-1 font-black uppercase tracking-tight transition-colors duration-300 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-200'}`}>
                {step.label}
              </span>
            </button>
            {index < steps.length - 1 && (
              <div className={`h-0.5 flex-grow rounded ${isPast ? 'bg-green-500' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default StepIndicator;
