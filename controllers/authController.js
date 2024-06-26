const dotenv = require('dotenv');
dotenv.config({path:'./config.env'})
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { promisify } = require('util');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
//const sendEmail = require('./../utils/email');

    const signToken = id => { //atleast 32 bit long JWT_SECRET is required for best encryption of signature
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN
    });
    };// logging out the user after jwt expires

    const createSendToken = (user, statusCode, res) => {
    const token = signToken(user._id);
    const cookieOptions = {
        expires: new Date(
        Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
        ),
        // secure:true, // activate this in production
        httpOnly: true
    };
    if (process.env.NODE_ENV === 'production') cookieOptions.secure = true;

    res.cookie('jwt', token, cookieOptions);

    // Remove password from output
    user.password = undefined;

    res.status(statusCode).json({
        status: 'success',
        token,
        data: {
        user
        }
    });
    };

    exports.signup = catchAsync(async (req, res, next) => {
    const newUser = await User.create({
        name: req.body.uname,
        email: req.body.usermail,
        password: req.body.pass,
        passwordConfirm: req.body.passconfirm,
        role: req.body.role,
        phoneNumber: req.body.phoneno
    });

    createSendToken(newUser, 201, res);
    });

    exports.login = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;

    // 1) Check if email and password exist
    if (!email || !password) {
        return next(new AppError('Please provide email and password!', 400));
    }
    // 2) Check if user exists && password is correct
    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.correctPassword(password, user.password))) {
        return next(new AppError('Incorrect email or password', 401));
    }

    // 3) If everything ok, send token to client
    createSendToken(user, 200, res);
    });

    exports.protect = catchAsync(async (req, res, next) => {
    // 1) Getting token and check if it's there
    let token;
    if ( // for jwt token (if it exists), header is always set to key : authorization and value begins with " Bearer" followed by token value
        req.headers.authorization
        &&
        req.headers.authorization.startsWith('Bearer')
    ) //=> token exists
    {
        token = req.headers.authorization.split(' ')[1];
        // authorization: 'Bearer faihiuhjfdfailjfoeiiurncl' -> the portion after bearer is index 1 and is the token value
    // after split we get an array of bearer and 2nd as value, then we take the [1] index's value
    }    
    else if(req.cookies.jwt){
        console.log(req.cookies.jwt);        
        token = req.cookies.jwt;}    
       if (!token) {    // if no such token exists or if token has expired
        return next(   // move to global error handling middleware
        new AppError('You are not logged in! Please log in to get access.', 401)
        // 401 means unauthorized
        );
    }
    // 2) Verification token
    // using verify function (asynchronous) of jwt -> to read the payload of token and pass the secret to create the test signature
    // we make it return a promise and then await it
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    console.log("decoded= ",JSON.stringify(decoded))
    // verify function makes sure that id is correct nad no one altered it in the payload
// decoded contains the decoded payload from jwt(JSONwebTOken)
    // 3) Check if user still exists
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
        return next(
        new AppError(
            'The user belonging to this token does no longer exist.',
            401
        )
        );
    }

    // 4) Check if user changed password after the token was issued -> if yes then old token is no longer valid
    // if (currentUser.changedPasswordAfter(decoded.iat)) {  // iat:issued at for jwt
    //     return next(
    //     new AppError('User recently changed password! Please log in again.', 401)
    //     );
    // }

    // GRANT ACCESS TO PROTECTED ROUTE
    req.user = currentUser;
    res.locals.user = currentUser;
    console.log("res.local.user = ",res.locals.user)
    next();
    });

    exports.restrictTo = (...roles) => { // passing an array of arguments
    return (req, res, next) => {   // returning a middleware function
        // roles ['admin', 'lead-guide']. role='user'
        if (!roles.includes(req.user.role)) {  // if user's role is not authorized
        // to access something -> user's role not contained in roles array
        return next(   // takes req.user from previous middleware -> protect
            new AppError('You do not have permission to perform this action', 403)
        );
        }  // 403 means forbidden

        next();
    };
    };

exports.logout = (req, res) => {
    res.cookie('jwt','loggedOut',{
        expires: new Date(Date.now() + 10 *60*60* 1000), //cookie expires in 10 sec
        httpOnly: true
    });
    res.status(200).json({status: 'success'})

}

// updating password by choice in profile settings
    exports.updatePassword = catchAsync(async (req, res, next) => {
    // 1) Get user from collection
    const user = await User.findById(req.user.id).select('+password');

    // 2) Check if POSTed current password is correct
    if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
        return next(new AppError('Your current password is wrong.', 401));
    }

    // 3) If so, update password
    user.password = req.body.password;
    user.passwordConfirm = req.body.passwordConfirm;
    await user.save();
    // User.findByIdAndUpdate will NOT work as intended because pre save middlewares 
    //of encrypting will not run on update and validate paswrd in schema will also not work

    // 4) Log user in, send JWT
    createSendToken(user, 200, res);
    });
