import React, {useState, useEffect} from 'react';
import axios from "axios";
import "../styles/CommentDisplay.css";
import Comment from "./Comment";
import CommentReply from "./CommentReply";

function CommentDisplay({pageId}) {
  const [comments, setComments] = useState([]);
  const [error, setError] = useState("");
  const [isReply, setIsReply] = useState(true);
  const [repliedCommentId, setRepliedCommentId] = useState("");
  const [isCommentReply, setIsCommentReply] = useState(false);
  const [replies, setReplies] = useState([]);

  useEffect(() => {
    const getComments = async () => {
      try {
        const response = await axios.get(`http://localhost:5000/servergetcomments/${pageId}`);
        const fetchedComments = response.data;
        setComments(fetchedComments);
        const replies = fetchedComments.filter(comment => comment.parent_id !== null);
        setReplies(replies);
      } catch (error) {
        console.log("Error fetching comments:", error.message);
        setError("Yorumlar Database'den alınmadı")
      } 
    }
    getComments();
  }, [pageId]);

  const replyComment = async (replyId) => {
    setRepliedCommentId(replyId);
    console.log(replyId);
    try {
      setIsReply(false)
      setIsCommentReply(true);
    } catch (error) {
      console.log(error.message);
    }
  }
    
  return (
    <>
      { isReply ? <Comment pageId={pageId} /> : <div></div> }
      <div className="comments-list" aria-label="List of comments">
        {error ? <div aria-live="polite">Error fetching comments: {error}</div> : <></>}
        {comments.filter(comment => comment.parent_id === null).map( (comment, index) => (
            <div key={index} className="comment-item">
                <div className="comment-header">
                  <span className="comment-name">{comment.name}</span>
                  <span className="comment-date">{comment.date}</span>
                </div>
                <div className='comment-body'>
                  <div className="comment-text">{comment.comment}</div>
                  {replies.map( (reply, index) => (
                    reply.parent_id === comment.id ? 
                        <div key={index} className='replyCommentContainer'>
                          <span style={{paddingTop: "10px"}}><strong>{reply.name}</strong> ({reply.date}): {reply.comment}</span>
                        </div>
                      : 
                        null
                  ))}
                  <button className='replyCommentBtn' aria-label="Reply to comment" onClick={() => replyComment(comment.id)}>Cevapla</button>
                  { isCommentReply ? 
                      repliedCommentId === comment.id ?
                          <CommentReply commentId2={comment.id} pageId3={pageId} /> 
                        :
                          null
                      :
                      null
                  }
                </div>
            </div>
        ))}
      </div>
    </>
  )
}

export default CommentDisplay;
