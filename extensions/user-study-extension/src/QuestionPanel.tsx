import React, { useEffect, useState } from 'react';
import { auth, db } from '../../../platform/app/src/firebase';;
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

type Question = {
  id: number;
  question: string;
  type: string;
  options: string[];
};

const QuestionPanel = ({ commandsManager, servicesManager, extensionManager }) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<{ [key: number]: any }>({});
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [sliderValue, setSliderValue] = useState<number>(5);


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

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setSliderValue(value);
    if (currentQuestion) {
      setAnswers(prevAnswers => ({
        ...prevAnswers,
        [currentQuestion.id]: value
      }));
    }
  };

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

  const resetResponses = () => {
    setAnswers({});
    setCurrentQuestion(questions[0]);
    setSliderValue(5);
  };

  const handleSubmit = async () => {
    try {
      const docRef = await addDoc(collection(db, "radiology-user-study"), {
          participantId: auth.currentUser.uid,
          studyId: `study-${auth.currentUser.uid}`,
          timestamp: serverTimestamp(),
          answers: answers
      });
      console.log("Document written with ID: ", docRef.id);
      resetResponses();

      alert('Your results have been submitted successfully!');
    } catch (e) {
        console.error("Error adding document: ", e);
        alert('Error submitting results. Please try again.');
    }
  };

    return (
    <div className="flex flex-col p-4">
      {currentQuestion && (
        <div key={currentQuestion.id} className="p-4 h-screen">
          <h2 className="text-lg font-normal text-aqua-pale mb-4">{currentQuestion.question}</h2>
          {currentQuestion.options && currentQuestion.options.length > 0 ? (
            <div className="flex flex-col ml-6 mt-2 text-aqua-pale">
              {currentQuestion.options.map((opt, idx) => (
                <label key={idx} className="flex items-center mb-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`question-${currentQuestion.id}`}
                    value={opt}
                    checked={answers[currentQuestion.id] === opt}
                    onChange={() => {
                      setAnswers(prevAnswers => ({
                        ...prevAnswers,
                        [currentQuestion.id]: opt
                      }));
                    }}
                    className="appearance-none w-3 h-3 form-radio text-primary-main mr-2 bg-white checked:bg-aqua-pale checked:border-white"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          ) : currentQuestion.type === 'free-response' ? (
            <textarea
              className="border-primary-main sshadow border-inputfield-main focus:border-inputfield-focus disabled:border-inputfield-disabled placeholder-inputfield-placeholder w-full appearance-none rounded border bg-black py-2 px-3 align-top text-[14px] text-sm leading-[1.2] leading-tight text-white transition duration-300 focus:outline-none"
              rows={4}
              placeholder="Type your answer here..."
              onChange={(e) => {
                if (currentQuestion) {
                  setAnswers(prevAnswers => ({
                    ...prevAnswers,
                    [currentQuestion.id]: e.target.value
                  }));
                }
              }}
            />
          ) : currentQuestion.type === 'slider' ? (
             <div className='flex justify-center items-center'>
              <input
                type="range"
                min="1"
                max="10"
                step="0.1"
                value={sliderValue}
                onChange={handleSliderChange}
                className= "w-full appearance-none rounded-md ml-1 w-4/5 cursor-pointer"
                style= {{
                  background: `linear-gradient(to right, rgb(90, 204, 230) 0%, rgb(90, 204, 230) ${(100 * (sliderValue - 1) / 9)}%, rgb(58, 63, 153) ${(100 * (sliderValue - 1) / 9)}%, rgb(58, 63, 153) 100%)`,
                  '--thumb-inner-color': '#5acce6',
                  '--thumb-outer-color': '#090c29',
                  height: '3px',
                } as React.CSSProperties}
              />
              <div className='border border-secondary-light rounded-md w-1/5 h-8 flex items-center justify-center m-2'>
                <span className="text-aqua-pale text-sm font-semibold">{sliderValue}</span>
              </div>
            </div>
          ): currentQuestion.type === 'scale' ? (
            <div className="flex flex-wrap gap-3 mt-2 justify-center">
              {Array.from({ length: 10 }, (_, i) => (
                <button
                  key={i + 1}
                  className={`w-11 h-11 flex items-center justify-center border border-secondary-main rounded shadow text-sm font-semibold
                    ${answers[currentQuestion.id] === i + 1 ? 'bg-primary-light text-primary-dark' : 'bg-primary-dark text-white'}`}
                  type="button"
                  onClick={() => {
                    if (currentQuestion) {
                      setAnswers(prevAnswers => ({
                        ...prevAnswers,
                        [currentQuestion.id]: i + 1
                      }));
                    }
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          ) : (
            <p className="italic text-gray-500 mt-2">Error loading question</p>
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
                onClick={
                  currentQuestion && currentQuestion.id === questions.length
                    ? () => {
                        handleSubmit();
                      }
                    : handleNext
                }
                className="text-[14px] text-sm px-3 py-1 bg-primary-light text-primary-dark rounded"
              >
                {currentQuestion && currentQuestion.id === questions.length ? 'Submit' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default QuestionPanel;
