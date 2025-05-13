import React from 'react';
import { LuThumbsUp , LuThumbsDown  } from "react-icons/lu";
import { GoThumbsup, GoThumbsdown } from "react-icons/go";
import { FaThumbsUp, FaThumbsDown } from "react-icons/fa6";
import PropTypes from 'prop-types';

const UserFeedbackRow = ({ question, thumbsUp, thumbsDown, onThumbsUp, onThumbsDown }) => {
  return (
    <tr>
      <td>{question}</td>
      <td style={{ userSelect: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <FaThumbsUp
            style={{ cursor: 'pointer', marginRight: '10px', color: thumbsUp ? 'green' : 'gray' }}
            onClick={onThumbsUp}
          />
          <FaThumbsDown
            style={{ cursor: 'pointer', marginRight: '10px', color: thumbsDown ? 'red' : 'gray'}}
            onClick={onThumbsDown}
          />
        </div>
      </td>
    </tr>
  );
};

UserFeedbackRow.propTypes = {
  question: PropTypes.string.isRequired,
  thumbsUp: PropTypes.bool,
  thumbsDown: PropTypes.bool,
  onThumbsUp: PropTypes.func.isRequired,
  onThumbsDown: PropTypes.func.isRequired,
};

export default UserFeedbackRow;
