import React, { useEffect, useState } from 'react';

type Question = {
  id: number;
  question: string;
  type: string;
  options: string[];
};

const QuestionPanel = ({ commandsManager, servicesManager, extensionManager }) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);

  useEffect(() => {
    fetch('/study-questions.json')
      .then((res) => res.json())
      .then((data: Question[]) =>
        {
          setQuestions(data)
          setCurrentQuestion(data[0]);
        })
      .catch((error) => console.error('Error loading questions:', error));
  }, []);

  const handleNext = () => {
    if (currentQuestion.id < questions.length) {
      setCurrentQuestion(questions[currentQuestion.id]);
    }
  };
  const handlePrev = () => {
    if (currentQuestion.id > 1) {
      setCurrentQuestion(questions[currentQuestion.id - 2]);
    }
  };


    return (
    <div className="flex flex-col p-4 h-screen">
      {currentQuestion && (
        <div key={currentQuestion.id} className="mb-6 p-4 rounded shadow flex-grow-0">
          <h2 className="text-lg font-semibold">{currentQuestion.question}</h2>
          {currentQuestion.options && currentQuestion.options.length > 0 ? (
            <ul className="list-disc ml-6 mt-2">
              {currentQuestion.options.map((opt, idx) => (
                <li key={idx}>{opt}</li>
              ))}
            </ul>
          ) : currentQuestion.type === 'free-response' ? (
            <textarea
              className="border-primary-main sshadow border-inputfield-main focus:border-inputfield-focus disabled:border-inputfield-disabled placeholder-inputfield-placeholder w-full appearance-none rounded border bg-black py-2 px-3 align-top text-[14px] text-sm leading-[1.2] leading-tight text-white transition duration-300 focus:outline-none"
              rows={4}
              placeholder="Type your answer here..."
            />
          ) : currentQuestion.type === 'scale' ? (
            <div className="flex flex-wrap gap-3 mt-2">
              {Array.from({ length: 10 }, (_, i) => (
                <button
                  key={i + 1}
                  className="w-11 h-11 flex items-center justify-center bg-primary-dark text-white border border-secondary-main rounded shadow text-sm font-semibold"
                  type="button"
                >
                  {i + 1}
                </button>
              ))}
            </div>
          ) : (
            <p className="italic text-gray-500 mt-2"></p>
          )}

          <div className="flex justify-between mt-4">
            <button
              onClick={handlePrev}
              disabled={!currentQuestion || currentQuestion.id === 1}
              className="text-[14px] text-sm px-3 py-1 bg-primary-dark text-primary-light border border-primary-light rounded"
            >
              Back
            </button>
            <div className="flex justify-center items-center">
              <p className="text-[14px] text-sm mr-4 text-primary-light">
                {currentQuestion ? `${currentQuestion.id} of ${questions.length}` : ''}
              </p>
              <button
                onClick={handleNext}
                disabled={!currentQuestion || currentQuestion.id === questions.length}
                className="text-[14px] text-sm px-3 py-1 bg-primary-light text-primary-dark rounded"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default QuestionPanel;
