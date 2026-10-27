package com.example.zeca.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import com.example.zeca.FirebaseRepository
import com.example.zeca.ui.theme.Cores
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import kotlinx.coroutines.launch

@Composable
fun TelaAutenticacao(onAutenticado: (FirebaseUser) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val auth = remember { FirebaseRepository.auth }
    var modoCadastro by remember { mutableStateOf(false) }
    var nome by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var senha by remember { mutableStateOf("") }
    var ocupado by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf("") }

    fun finalizarLogin(user: FirebaseUser) {
        ocupado = false
        onAutenticado(user)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF151A1D), Cores.Fundo, Color(0xFF090D10))))
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.14f), Color.White.copy(alpha = 0.055f))),
                    RoundedCornerShape(24.dp),
                )
                .border(1.dp, Color.White.copy(alpha = 0.24f), RoundedCornerShape(24.dp))
                .padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("ZECA", color = Cores.Verde, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Text(
                if (modoCadastro) "Criar sua conta" else "Entre para jogar",
                color = Color.White,
                fontSize = 27.sp,
                fontWeight = FontWeight.Black,
            )
            Text("Use Google ou seu e-mail.", color = Color.White.copy(alpha = 0.66f), fontSize = 14.sp)

            if (modoCadastro) {
                OutlinedTextField(
                    value = nome,
                    onValueChange = { nome = it.take(24); erro = "" },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Apelido") },
                    singleLine = true,
                )
            }
            OutlinedTextField(
                value = email,
                onValueChange = { email = it.trim(); erro = "" },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("E-mail") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            )
            if (modoCadastro) {
                Text(
                    "Cada e-mail pode ser usado em uma única conta.",
                    color = Color.White.copy(alpha = 0.58f),
                    fontSize = 11.sp,
                )
            }
            OutlinedTextField(
                value = senha,
                onValueChange = { senha = it; erro = "" },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Senha") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            )

            Button(
                onClick = {
                    val emailValido = android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()
                    if (modoCadastro && nome.trim().length !in 2..24) {
                        erro = "O apelido deve ter entre 2 e 24 caracteres."
                    } else if (!emailValido || senha.length < 6) {
                        erro = "Informe um e-mail válido e uma senha com pelo menos 6 caracteres."
                    } else {
                        ocupado = true
                        erro = ""
                        val tarefa = if (modoCadastro) {
                            auth.createUserWithEmailAndPassword(email.trim(), senha)
                        } else {
                            auth.signInWithEmailAndPassword(email.trim(), senha)
                        }
                        tarefa.addOnCompleteListener { result ->
                            val user = result.result?.user
                            if (!result.isSuccessful || user == null) {
                                ocupado = false
                                erro = mensagemAuth(result.exception)
                            } else if (modoCadastro) {
                                val atualizacao = com.google.firebase.auth.UserProfileChangeRequest.Builder()
                                    .setDisplayName(nome.trim())
                                    .build()
                                user.updateProfile(atualizacao).addOnCompleteListener { profileResult ->
                                    if (profileResult.isSuccessful) {
                                        user.sendEmailVerification()
                                            .addOnSuccessListener {
                                                Toast.makeText(
                                                    context,
                                                    "O Firebase aceitou o envio. Confira sua caixa de entrada e o spam.",
                                                    Toast.LENGTH_LONG,
                                                ).show()
                                                finalizarLogin(user)
                                            }
                                            .addOnFailureListener { verificationError ->
                                                Toast.makeText(
                                                    context,
                                                    "Conta criada, mas o envio falhou: ${mensagemAuth(verificationError)}. Você pode reenviar pela Carteira.",
                                                    Toast.LENGTH_LONG,
                                                ).show()
                                                finalizarLogin(user)
                                            }
                                    }
                                    else {
                                        ocupado = false
                                        erro = mensagemAuth(profileResult.exception)
                                    }
                                }
                            } else {
                                finalizarLogin(user)
                            }
                        }
                    }
                },
                enabled = !ocupado,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Cores.Verde),
            ) {
                Text(if (ocupado) "Aguarde..." else if (modoCadastro) "Cadastrar com e-mail" else "Entrar com e-mail", color = Color.Black)
            }

            TextButton(
                onClick = {
                    auth.sendPasswordResetEmail(email)
                        .addOnSuccessListener { erro = "Enviamos um link para redefinir sua senha." }
                        .addOnFailureListener { erro = mensagemAuth(it) }
                },
                enabled = !modoCadastro && email.isNotBlank() && !ocupado,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            ) { Text("Esqueci minha senha") }

            RowDivider()

            Button(
                onClick = {
                    val clientIdResource = context.resources.getIdentifier(
                        "default_web_client_id",
                        "string",
                        context.packageName,
                    )
                    if (clientIdResource == 0) {
                        erro = "Para ativar o Google, habilite esse provedor no Firebase e baixe o google-services.json atualizado com o cliente OAuth Web."
                    } else {
                        ocupado = true
                        erro = ""
                        scope.launch {
                            try {
                                val option = GetGoogleIdOption.Builder()
                                    .setServerClientId(context.getString(clientIdResource))
                                    .setFilterByAuthorizedAccounts(false)
                                    .setAutoSelectEnabled(false)
                                    .build()
                                val request = GetCredentialRequest.Builder()
                                    .addCredentialOption(option)
                                    .build()
                                val credential = CredentialManager.create(context).getCredential(context, request).credential
                                if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                                    ocupado = false
                                    erro = "Não foi possível obter a conta Google."
                                } else {
                                    val token = GoogleIdTokenCredential.createFrom(credential.data).idToken
                                    auth.signInWithCredential(GoogleAuthProvider.getCredential(token, null))
                                        .addOnCompleteListener { result ->
                                            val user = result.result?.user
                                            if (!result.isSuccessful || user == null) {
                                                ocupado = false
                                                erro = mensagemAuth(result.exception)
                                            } else finalizarLogin(user)
                                        }
                                }
                            } catch (exception: GetCredentialException) {
                                ocupado = false
                                erro = exception.localizedMessage ?: "Não foi possível entrar com Google."
                            } catch (exception: Exception) {
                                ocupado = false
                                erro = exception.localizedMessage ?: "Não foi possível entrar com Google."
                            }
                        }
                    }
                },
                enabled = !ocupado,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Color.White.copy(alpha = 0.13f)),
            ) { Text("Continuar com Google", color = Color.White) }

            if (erro.isNotBlank()) Text(erro, color = Cores.Laranja, fontSize = 12.sp)

            TextButton(
                onClick = { modoCadastro = !modoCadastro; erro = "" },
                enabled = !ocupado,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            ) {
                Text(if (modoCadastro) "Já tenho uma conta" else "Criar uma conta")
            }
        }
    }
}

@Composable
private fun RowDivider() {
    Spacer(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.13f)))
}

private fun mensagemAuth(exception: Exception?): String = when {
    exception == null -> "Não foi possível concluir a operação."
    exception is FirebaseAuthUserCollisionException ->
        "Já existe uma conta vinculada a este e-mail. Entre usando o método do cadastro original."
    else -> exception.localizedMessage ?: "Não foi possível concluir a operação."
}