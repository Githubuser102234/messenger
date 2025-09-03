import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getDatabase, ref, push, set, get, query, orderByChild, equalTo, onValue, onDisconnect, update, remove } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const app = window.firebaseApp;
const auth = getAuth(app);
const database = getDatabase(app);

let currentUser = null;
let currentConversationId = null;
let typingTimeout;

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        initApp();
    } else {
        signInAnonymously(auth).then(userCredential => {
            currentUser = userCredential.user;
            initApp();
        }).catch(error => {
            console.error("Authentication failed:", error);
        });
    }
});

function initApp() {
    const params = new URLSearchParams(window.location.search);
    const inviteId = params.get('inviteid');

    if (inviteId) {
        joinConversation(inviteId);
    } else {
        showInboxScreen();
    }

    const userStatusRef = ref(database, 'status/' + currentUser.uid);
    onDisconnect(userStatusRef).update({ online: false });
    update(userStatusRef, { online: true });
}

function showInboxScreen() {
    document.getElementById('inbox-screen').classList.add('active');
    document.getElementById('chat-screen').classList.remove('active');
    document.getElementById('new-message-btn').onclick = createNewConversation;
}

function showChatScreen() {
    document.getElementById('inbox-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');
    document.getElementById('back-to-inbox-btn').onclick = showInboxScreen;
    document.getElementById('send-btn').onclick = sendMessage;
    document.getElementById('message-input').onkeyup = handleTyping;
}

function createNewConversation() {
    const newConversationRef = push(ref(database, 'conversations'));
    const conversationId = newConversationRef.key;
    const inviteId = generateInviteId();
    
    set(newConversationRef, {
        members: {
            [currentUser.uid]: true
        },
        invitation: {
            inviteId: inviteId,
            creator: currentUser.uid
        }
    }).then(() => {
        const inviteLink = `${window.location.origin}/?inviteid=${inviteId}`;
        alert(`Your new conversation is created. Share this link: ${inviteLink}`);
        openChatRoom(conversationId);
    });
}

function joinConversation(inviteId) {
    const conversationsRef = ref(database, 'conversations');
    const q = query(conversationsRef, orderByChild('invitation/inviteId'), equalTo(inviteId));

    get(q).then(snapshot => {
        if (snapshot.exists()) {
            const conversationData = snapshot.val();
            const conversationId = Object.keys(conversationData)[0];
            const conversation = conversationData[conversationId];

            if (Object.keys(conversation.members).length < 2) {
                const membersRef = ref(database, `conversations/${conversationId}/members`);
                set(ref(membersRef, currentUser.uid), true).then(() => {
                    alert('You have joined the conversation!');
                    remove(ref(database, `conversations/${conversationId}/invitation`));
                    openChatRoom(conversationId);
                });
            } else {
                alert('This conversation is already full!');
            }
        } else {
            alert('Invalid invite link.');
        }
    });
}

function openChatRoom(conversationId) {
    currentConversationId = conversationId;
    showChatScreen();
    document.getElementById('messages-container').innerHTML = '';
    
    const messagesRef = ref(database, 'messages/' + conversationId);
    onValue(messagesRef, (snapshot) => {
        document.getElementById('messages-container').innerHTML = '';
        snapshot.forEach(childSnapshot => {
            displayMessage(childSnapshot.val(), childSnapshot.key);
        });
        document.getElementById('messages-container').scrollTop = document.getElementById('messages-container').scrollHeight;
    });

    const statusRef = ref(database, 'status');
    onValue(statusRef, (snapshot) => {
        const statuses = snapshot.val();
        const otherUserId = getOtherUser(conversationId);
        
        const statusDisplay = document.getElementById('status-display');
        if (statuses && statuses[otherUserId]) {
            if (statuses[otherUserId].typing === conversationId) {
                statusDisplay.textContent = 'Typing...';
            } else if (statuses[otherUserId].online) {
                statusDisplay.textContent = 'Online';
            } else {
                statusDisplay.textContent = 'Offline';
            }
        } else {
            statusDisplay.textContent = 'Offline';
        }
    });
}

function sendMessage(replyToId = null) {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;

    const messagesRef = ref(database, 'messages/' + currentConversationId);
    const newMessageRef = push(messagesRef);
    set(newMessageRef, {
        senderId: currentUser.uid,
        text: text,
        timestamp: new Date().getTime(),
        isDeleted: false,
        replyTo: replyToId
    });

    input.value = '';
    setTypingStatus(false);
}

function displayMessage(message, messageId) {
    const container = document.getElementById('messages-container');
    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';
    
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    
    if (message.senderId === currentUser.uid) {
        messageBubble.classList.add('my-message');
        messageElement.classList.add('my-message');
    }
    
    if (message.isDeleted) {
        messageElement.textContent = "This message was deleted.";
    } else {
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.textContent = message.text;
        messageElement.appendChild(messageContent);

        const actions = document.createElement('div');
        actions.className = 'message-actions';
        
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.title = "Delete";
        deleteBtn.onclick = () => deleteMessage(messageId);
        actions.appendChild(deleteBtn);

        const replyBtn = document.createElement('button');
        replyBtn.innerHTML = '<i class="fas fa-reply"></i>';
        replyBtn.title = "Reply";
        replyBtn.onclick = () => {
            const input = document.getElementById('message-input');
            input.focus();
            document.getElementById('send-btn').onclick = () => sendMessage(messageId);
        };
        actions.appendChild(replyBtn);

        messageElement.appendChild(actions);
    }
    messageBubble.appendChild(messageElement);
    container.appendChild(messageBubble);
}

function deleteMessage(messageId) {
    if (!currentConversationId) return;
    const messageRef = ref(database, `messages/${currentConversationId}/${messageId}`);
    update(messageRef, { isDeleted: true });
}

function handleTyping() {
    setTypingStatus(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        setTypingStatus(false);
    }, 1500);
}

function setTypingStatus(isTyping) {
    const userStatusRef = ref(database, 'status/' + currentUser.uid);
    if (isTyping) {
        update(userStatusRef, { typing: currentConversationId });
    } else {
        update(userStatusRef, { typing: null });
    }
}

// This is a placeholder. You need to fetch the conversation members from the database
// to find the other user's ID.
function getOtherUser(conversationId) {
    // This function would query the database to find the other user
    // For a one-on-one chat, it would look up the 'members' node of the conversation
    // and return the ID that is not the current user's.
    return "otherUserIdPlaceholder"; 
}

function generateInviteId() {
    return Math.random().toString(36).substring(2, 8);
}
