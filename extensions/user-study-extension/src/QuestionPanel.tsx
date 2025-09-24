import React, { useEffect, useState } from 'react';
import { auth, db } from '../../../platform/app/src/firebase';
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

  const { uiNotificationService } = servicesManager.services;

  useEffect(() => {
    fetch('/study-questions.json')
      .then(res => res.json())
      .then((data: Question[]) => {
        setQuestions(data);
        setCurrentQuestion(data[0]);
      })
      .catch(error => console.error('Error loading questions:', error));
  }, []);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setSliderValue(value);
    if (currentQuestion) {
      setAnswers(prevAnswers => ({
        ...prevAnswers,
        [currentQuestion.id]: value,
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
    if (Object.keys(answers).length !== questions.length - 1) {
      uiNotificationService.show({
        title: 'Results Not Submitted',
        message: 'Please answer all the questions before submitting',
        type: 'warning',
        duration: 3000,
      });
      return;
    }
    try {
      const docRef = await addDoc(collection(db, 'radiology-user-study'), {
        participantId: auth.currentUser.uid,
        studyId: `study-${auth.currentUser.uid}`,
        timestamp: serverTimestamp(),
        answers: answers,
      });
      console.log('Document written with ID: ', docRef.id);
      resetResponses();

      uiNotificationService.show({
        title: 'Results Submitted',
        message: 'You have successfully submitted your responses',
        type: 'success',
        duration: 3000,
      });
    } catch (e) {
      console.error('Error adding document: ', e);
      uiNotificationService.show({
        title: 'Something Went Wrong',
        message: 'Please try again later',
        type: 'error',
        duration: 3000,
      });
    }
  };

  return (
    <div style={{ height: '100vh' }} className="flex h-screen flex-col">
      <div className="flex w-full p-4">
        {currentQuestion && (
          <div className="w-full p-4">
            <h2 className="text-aqua-pale mb-4 text-lg font-normal">{currentQuestion.question}</h2>
            {currentQuestion.type === 'paragraph' && currentQuestion.options.length > 0 ? (
              <div className="text-aqua-pale ml-6 mt-2 flex flex-col">
                <p className="m-2 text-[14px]">{currentQuestion.options[0]}</p>
                <p className="m-2 text-[14px]">{currentQuestion.options[1]}</p>
                <p className="m-2 text-[14px]">{currentQuestion.options[2]}</p>
              </div>
            ) : currentQuestion.type === 'multiple-choice' ? (
              <div className="text-aqua-pale ml-6 mt-2 flex w-full flex-col">
                {currentQuestion.options.map((opt, idx) => (
                  <label key={idx} className="mb-2 flex cursor-pointer items-center">
                    <input
                      type="radio"
                      name={`question-${currentQuestion.id}`}
                      value={opt}
                      checked={answers[currentQuestion.id] === opt}
                      onChange={() => {
                        setAnswers(prevAnswers => ({
                          ...prevAnswers,
                          [currentQuestion.id]: opt,
                        }));
                      }}
                      className="form-radio text-primary-main checked:bg-aqua-pale mr-2 h-3 w-3 appearance-none bg-white checked:border-white"
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
                value={answers[currentQuestion.id] || ''}
                onChange={e => {
                  if (currentQuestion) {
                    setAnswers(prevAnswers => ({
                      ...prevAnswers,
                      [currentQuestion.id]: e.target.value,
                    }));
                  }
                }}
              />
            ) : currentQuestion.type === 'slider' ? (
              <div className="flex w-full items-center justify-center">
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.1"
                  value={sliderValue}
                  onChange={handleSliderChange}
                  className="ml-1 w-full w-4/5 cursor-pointer appearance-none rounded-md"
                  style={
                    {
                      background: `linear-gradient(to right, rgb(90, 204, 230) 0%, rgb(90, 204, 230) ${(100 * (sliderValue - 1)) / 9}%, rgb(58, 63, 153) ${(100 * (sliderValue - 1)) / 9}%, rgb(58, 63, 153) 100%)`,
                      '--thumb-inner-color': '#5acce6',
                      '--thumb-outer-color': '#090c29',
                      height: '3px',
                    } as React.CSSProperties
                  }
                />
                <div className="border-secondary-light m-2 flex h-8 w-1/5 items-center justify-center rounded-md border">
                  <span className="text-aqua-pale text-sm font-semibold">{sliderValue}</span>
                </div>
              </div>
            ) : currentQuestion.type === 'scale' ? (
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                {Array.from({ length: 10 }, (_, i) => (
                  <button
                    key={i + 1}
                    className={`border-secondary-main flex h-11 w-11 items-center justify-center rounded border text-sm font-semibold shadow ${answers[currentQuestion.id] === i + 1 ? 'bg-primary-light text-primary-dark' : 'bg-primary-dark text-white'}`}
                    type="button"
                    onClick={() => {
                      if (currentQuestion) {
                        setAnswers(prevAnswers => ({
                          ...prevAnswers,
                          [currentQuestion.id]: i + 1,
                        }));
                      }
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 italic text-gray-500">Error loading question</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-between">
        <button
          onClick={handlePrev}
          disabled={!currentQuestion || currentQuestion.id === 1}
          className="bg-primary-dark text-primary-light border-primary-light rounded border px-3 py-1 text-[14px] text-sm"
        >
          Back
        </button>
        <div className="flex items-center justify-center">
          <p className="text-primary-light mr-4 text-[14px] text-sm">
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
            className="bg-primary-light text-primary-dark rounded px-3 py-1 text-[14px] text-sm"
          >
            {currentQuestion && currentQuestion.id === questions.length ? 'Submit' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuestionPanel;
