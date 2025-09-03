import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getDatabase, ref, push, set, get, query, orderByChild, equalTo, onValue, onDisconnect, update, remove } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

// Ensure firebaseApp is available from the HTML script tag
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
        renderInbox();
    }

    // Set user online status
    const userStatusRef = ref(database, 'status/' + currentUser.uid);
    onDisconnect(userStatusRef).update({ online: false });
    update(userStatusRef, { online: true });
}

function renderInbox() {
    // This part would need more complex logic to list conversations
    document.getElementById('new-message-btn').onclick = createNewConversation;
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
        // This function needs a way to determine the other user's ID
        // For a one-on-one chat, you'd fetch the other member from the conversation's `members` object
        const otherUserId = "otherUserIdPlaceholder"; 

        const statusDisplay = document.getElementById('status-display');
        if (statuses && statuses[otherUserId] && statuses[otherUserId].typing === conversationId) {
            statusDisplay.textContent = 'Typing...';
        } else if (statuses && statuses[otherUserId] && statuses[otherUserId].online) {
            statusDisplay.textContent = 'Online';
        } else {
            statusDisplay.textContent = 'Offline';
        }
    });

    document.getElementById('send-btn').onclick = sendMessage;
    document.getElementById('message-input').onkeyup = handleTyping;
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
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    if (message.senderId === currentUser.uid) {
        messageElement.classList.add('my-message');
    }
    
    if (message.isDeleted) {
        messageElement.textContent = "This message was deleted.";
    } else {
        const messageText = document.createElement('p');
        messageText.textContent = message.text;
        messageElement.appendChild(messageText);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = () => deleteMessage(messageId);
        messageElement.appendChild(deleteBtn);

        const replyBtn = document.createElement('button');
        replyBtn.textContent = 'Reply';
        replyBtn.onclick = () => {
            const input = document.getElementById('message-input');
            input.focus();
            document.getElementById('send-btn').onclick = () => sendMessage(messageId);
        };
        messageElement.appendChild(replyBtn);
    }
    container.appendChild(messageElement);
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

function generateInviteId() {
    return Math.random().toString(36).substring(2, 8);
}

